import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildForecast } from "./services/forecast.js";
import { PhotonGeocoding } from "./providers/photon.js";
import { providerHealth } from "./services/health.js";
import { applyMigrations } from "./db/applyMigrations.js";
import { calculateEot20, eot20Status } from "./providers/eot20.js";
import { nearestOfficialStations } from "./providers/bomOfficialTide.js";
import { RULE_VERSION } from "./domain/scoring.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });
const dbPath = process.env.DATABASE_PATH ?? "./data/tideline.db";
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
applyMigrations(db);
const geocoder = new PhotonGeocoding();

const inAustralia = (lat: number, lon: number) =>
  lat >= -44 && lat <= -10 && lon >= 112 && lon <= 154;
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "request failed");
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const providerFailure = message.startsWith("WEATHER_PROVIDER");
  reply
    .code(providerFailure ? 503 : 500)
    .send({
      status: "unavailable",
      reason: providerFailure ? message : "INTERNAL_ERROR",
      data: null,
    });
});
app.get("/api/health", async () => ({
  status: "ok",
  time: new Date().toISOString(),
}));
app.get("/api/geocode/search", async (req, reply) => {
  const q = req.query as Record<string, string>;
  const query = String(q.q ?? "").trim();
  if (query.length < 3 || query.length > 80)
    return reply
      .code(400)
      .send({ status: "invalid", reason: "QUERY_LENGTH", data: null });
  const lat = Number(q.lat),
    lon = Number(q.lon);
  const focus =
    Number.isFinite(lat) && Number.isFinite(lon) && inAustralia(lat, lon)
      ? { latitude: lat, longitude: lon }
      : undefined;
  const results = await geocoder.search(query, focus);
  return { status: "available", provider: "Photon", data: results };
});
app.get("/api/geocode/reverse", async (req, reply) => {
  const q = req.query as Record<string, string>;
  const latitude = Number(q.lat),
    longitude = Number(q.lon);
  if (!inAustralia(latitude, longitude))
    return reply
      .code(400)
      .send({ status: "invalid", reason: "OUTSIDE_AUSTRALIA", data: null });
  const result = await geocoder.reverse(latitude, longitude);
  return result
    ? { status: "available", provider: "Photon", data: result }
    : { status: "no_data", provider: "Photon", data: null };
});
app.get("/api/forecast", async (req, reply) => {
  const q = req.query as Record<string, string>;
  const latitude = Number(q.lat),
    longitude = Number(q.lon);
  if (!Number.isFinite(latitude) || !inAustralia(latitude, longitude))
    return reply
      .code(400)
      .send({ status: "invalid", reason: "OUTSIDE_AUSTRALIA", data: null });
  const forecast = await buildForecast(
    {
      id: q.spotId ?? "selected-location",
      latitude,
      longitude,
      name: q.name ?? "Selected location",
      address: q.address ?? "",
      state: q.state ?? "NSW",
      timezone: q.timezone ?? "Australia/Sydney",
      spotType: q.spotType ?? "wharf",
      waterType: q.waterType ?? "estuary_or_harbour",
      fishingMethod: q.fishingMethod ?? "bottom_fishing",
      preferredTideSource: q.preferredTideSource ?? "BOM_OFFICIAL",
    },
    db,
  );
  let snapshotId: string | null = null;
  const spotId = q.spotId ?? "";
  if (spotId && db.prepare("SELECT 1 FROM spots WHERE id=?").get(spotId)) {
    snapshotId = randomUUID();
    const snapshot = {
      generatedAtUtc: forecast.generatedAtUtc,
      spot: forecast.spot,
      tides: forecast.tides,
      warnings: forecast.warnings,
      observation: forecast.observation,
      bomMarineForecast: forecast.bomMarineForecast,
      marineApplicability: forecast.marineApplicability,
      rainfallContext: forecast.rainfallContext,
      providerStatus: forecast.providerStatus,
      days: forecast.days.map((day) => ({ date: day.date, windows: day.windows, scores: day.hours.map((hour) => ({ timestampUtc: hour.timestampUtc, score: hour.score, tideHeightM: hour.tideHeightM, tidePhase: hour.tidePhase })) })),
    };
    db.prepare("INSERT INTO forecast_snapshots (id,spot_id,rule_version,payload_json,created_at_utc) VALUES (?,?,?,?,?)").run(snapshotId, spotId, RULE_VERSION, JSON.stringify(snapshot), new Date().toISOString());
  }
  return { ...forecast, snapshotId };
});
app.get("/api/tides/eot20",async(req,reply)=>{const q=req.query as Record<string,string>;const latitude=Number(q.lat),longitude=Number(q.lon),intervalMinutes=Number(q.intervalMinutes??60);if(!inAustralia(latitude,longitude)||!Number.isFinite(intervalMinutes)||intervalMinutes<10)return reply.code(400).send({status:"invalid",reason:"INVALID_TIDE_QUERY",provider:"EOT20"});try{const data=await calculateEot20({latitude,longitude,startUtc:q.startUtc??new Date().toISOString(),endUtc:q.endUtc??new Date(Date.now()+7*86400000).toISOString(),intervalMinutes,spotType:q.spotType??"beach",waterType:q.waterType});return{status:"available",provider:"EOT20",data};}catch(error){const reason=error instanceof Error?error.message:"EOT20_FAILED";return reply.code(reason==="EOT20_NOT_APPLICABLE"?422:503).send({status:"unavailable",reason,provider:"EOT20"});}});
app.get("/api/spots", async () =>
  db
    .prepare(
      "SELECT s.id,s.name,COALESCE(s.address,'') AS address,s.latitude,s.longitude,s.state,s.timezone,s.spot_type AS spotType,s.water_type AS waterType,s.fishing_method AS fishingMethod,s.target_species AS targetSpecies,s.allow_night AS allowNight,s.created_at_utc AS createdAtUtc,COALESCE(p.preferred_tide_source,'BOM_OFFICIAL') AS preferredTideSource FROM spots s LEFT JOIN spot_environment_preferences p ON p.spot_id=s.id ORDER BY s.created_at_utc DESC",
    )
    .all(),
);
app.get("/api/spots/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const spot = db
    .prepare(
      "SELECT id,name,COALESCE(address,'') AS address,latitude,longitude,state,timezone,spot_type AS spotType,water_type AS waterType,fishing_method AS fishingMethod,target_species AS targetSpecies,allow_night AS allowNight,created_at_utc AS createdAtUtc FROM spots WHERE id=?",
    )
    .get(id);
  return spot ?? reply.code(404).send({ status: "not_found", data: null });
});
app.post("/api/spots", async (req, reply) => {
  const b = req.body as Record<
    string,
    string | number | boolean | null | undefined
  >;
  const latitude = Number(b.latitude),
    longitude = Number(b.longitude);
  if (!inAustralia(latitude, longitude))
    return reply
      .code(400)
      .send({ status: "invalid", reason: "OUTSIDE_AUSTRALIA", data: null });
  const id = String(b.id ?? randomUUID()),
    now = new Date().toISOString();
  db.prepare(
    `INSERT INTO spots (id,name,address,latitude,longitude,state,timezone,spot_type,water_type,fishing_method,target_species,allow_night,created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,state=excluded.state,timezone=excluded.timezone,spot_type=excluded.spot_type,water_type=excluded.water_type,fishing_method=excluded.fishing_method,target_species=excluded.target_species,allow_night=excluded.allow_night`,
  ).run(
    id,
    b.name,
    b.address ?? "",
    latitude,
    longitude,
    b.state ?? "NSW",
    b.timezone ?? "Australia/Sydney",
    b.spotType ?? "wharf",
    b.waterType ?? "estuary_or_harbour",
    b.fishingMethod ?? "bottom_fishing",
    b.targetSpecies ?? null,
    b.allowNight ? 1 : 0,
    now,
  );
  return reply
    .code(201)
    .send(
      db
        .prepare(
          "SELECT id,name,address,latitude,longitude,state,timezone,spot_type AS spotType,fishing_method AS fishingMethod FROM spots WHERE id=?",
        )
        .get(id),
    );
});
app.put("/api/spots/:id/environment-preferences", async (req, reply) => {
  const { id } = req.params as { id: string };
  const spot = db.prepare("SELECT latitude,longitude,state FROM spots WHERE id=?").get(id) as {latitude:number;longitude:number;state:string}|undefined;
  if (!spot)
    return reply.code(404).send({ status: "not_found", data: null });
  const b = req.body as Record<
    string,
    string | number | boolean | null | undefined
  >;
  const existing=(db.prepare("SELECT * FROM spot_environment_preferences WHERE spot_id=?").get(id)??{}) as Record<string,unknown>;
  const legacyMap:Record<string,string>={OFFICIAL:"BOM_OFFICIAL",EOT20:"EOT20_MODEL",NONE:"NO_TIDE"};
  const rawSource=String(b.preferredTideSource??existing.preferred_tide_source??"BOM_OFFICIAL").toUpperCase();
  const source=legacyMap[rawSource]??rawSource;
  if (!["BOM_OFFICIAL", "EOT20_MODEL", "NO_TIDE"].includes(source))
    return reply
      .code(400)
      .send({ status: "invalid", reason: "INVALID_TIDE_SOURCE", data: null });
  const stationId=String(b.officialStationId??existing.official_station_id??'')||null;
  const stateStations=(nearestOfficialStations(db,spot,20) as Array<Record<string,unknown>>).filter(item=>item.state===spot.state);
  if(source==='EOT20_MODEL'&&eot20Status().status!=='REAL')return reply.code(409).send({status:'unavailable',reason:eot20Status().reason,data:null});
  if(source==='BOM_OFFICIAL'&&!stateStations.length)return reply.code(409).send({status:'unavailable',reason:'OFFICIAL_TIDE_UNAVAILABLE',data:null});
  if(b.stationLocked&&(!stationId||!stateStations.some(item=>String(item.station_id)===stationId)))return reply.code(400).send({status:'invalid',reason:'OFFICIAL_STATION_NOT_AVAILABLE',data:null});
  db.prepare(
    `INSERT INTO spot_environment_preferences (spot_id,preferred_tide_source,official_station_id,official_station_time_offset_min,official_station_height_offset_m,station_locked,model_enabled,last_user_selection_utc) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(spot_id) DO UPDATE SET preferred_tide_source=excluded.preferred_tide_source,official_station_id=excluded.official_station_id,official_station_time_offset_min=excluded.official_station_time_offset_min,official_station_height_offset_m=excluded.official_station_height_offset_m,station_locked=excluded.station_locked,model_enabled=excluded.model_enabled,last_user_selection_utc=excluded.last_user_selection_utc`,
  ).run(
    id,
    source,
    stationId,
    Number(b.officialStationTimeOffset ?? existing.official_station_time_offset_min ?? 0),
    Number(b.officialStationHeightOffset ?? existing.official_station_height_offset_m ?? 0),
    b.stationLocked===undefined?Number(existing.station_locked??0):(b.stationLocked ? 1 : 0),
    b.modelEnabled===undefined?Number(existing.model_enabled??1):(b.modelEnabled === false ? 0 : 1),
    new Date().toISOString(),
  );
  return { status: "saved", spotId: id, preferredTideSource: source };
});
app.get("/api/logs", async () =>
  db
    .prepare(
      "SELECT id,spot_id AS spotId,started_at_utc AS startedAtUtc,ended_at_utc AS endedAtUtc,method,bait,bites,catches,kept,rating,gear_issues AS gearIssues,notes,created_at_utc AS createdAtUtc FROM fishing_logs ORDER BY started_at_utc DESC LIMIT 100",
    )
    .all(),
);
app.post("/api/logs", async (req, reply) => {
  const b = req.body as Record<string, string | number | null | undefined>;
  const spotId = String(b.spotId ?? "");
  if (!spotId || !db.prepare("SELECT 1 FROM spots WHERE id=?").get(spotId))
    return reply
      .code(409)
      .send({
        status: "invalid",
        reason: "SPOT_MUST_BE_SAVED_FIRST",
        data: null,
      });
  const id = randomUUID(),
    now = new Date().toISOString();
  db.prepare(
    "INSERT INTO fishing_logs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    spotId,
    b.forecastSnapshotId ?? null,
    b.startedAtUtc,
    b.endedAtUtc,
    b.method ?? "bottom_fishing",
    b.bait ?? null,
    b.bites ?? 0,
    b.catches ?? 0,
    b.kept ?? 0,
    b.rating ?? 3,
    b.gearIssues ?? null,
    b.notes ?? null,
    now,
  );
  return reply.code(201).send({ id });
});
app.get("/api/analytics", async () => {
  const row = db
    .prepare(
      "SELECT COUNT(*) sessions, COALESCE(SUM(catches),0) catches, COALESCE(SUM(bites),0) bites, COALESCE(AVG(rating),0) rating, COALESCE(SUM(CASE WHEN catches=0 THEN 1 ELSE 0 END),0) blanks FROM fishing_logs",
    )
    .get() as {
    sessions: number;
    catches: number;
    bites: number;
    rating: number;
    blanks: number;
  };
  return {
    ...row,
    blankRate: row.sessions ? Math.round((row.blanks / row.sessions) * 100) : 0,
    insufficientSample: row.sessions < 10,
  };
});
app.get("/api/system-status", async () => {
  let database = "available";
  try {
    db.prepare("SELECT 1").get();
  } catch {
    database = "unavailable";
  }
  const tideImports = db
    .prepare(
      "SELECT source_year AS year,state,station_name AS stationName,file_sha256 AS sha256,downloaded_at_utc AS downloadedAtUtc,parse_status AS parseStatus,row_count AS rowCount FROM tide_imports ORDER BY downloaded_at_utc DESC",
    )
    .all();
  return {
    generatedAtUtc: new Date().toISOString(),
    map: {
      status: "REAL",
      provider: "Leaflet + OpenStreetMap standard tiles",
      detail:
        "Interactive map, marker drag, search selection and reverse geocoding; public tiles have no SLA",
    },
    addressSearch: { status: "REAL", provider: "Photon" },
    weather: {
      status: providerHealth.weather.status,
      lastSuccess: providerHealth.weather.lastSuccess,
    },
    marine: {
      status: providerHealth.marine.status,
      lastSuccess: providerHealth.marine.lastSuccess,
    },
    officialTideImports: tideImports,
    eot20: eot20Status(),
    providers: providerHealth,
    database: {
      status: database,
      pathConfigured: Boolean(process.env.DATABASE_PATH),
      foreignKeys: true,
    },
    cache: {
      status: "available",
      type: "provider TTL memory cache + SQLite provider_cache table",
      staleDataIsLabelled: true,
    },
    scheduler: {
      status: "NOT_IMPLEMENTED",
      detail: "Annual next-year tide check is not scheduled",
    },
    missingEnvironmentVariables: eot20Status().modelPathConfigured
      ? []
      : ["EOT20_MODEL_PATH"],
    usesMockData: false,
    usesSimulatedTides: false,
    recentProviderErrors: Object.fromEntries(
      Object.entries(providerHealth)
        .filter(([, item]) => item.lastError)
        .map(([name, item]) => [name, item.lastError]),
    ),
    degraded: Object.values(providerHealth).some(
      (item) => item.status !== "REAL" && item.status !== "NOT_APPLICABLE",
    ),
  };
});
if (existsSync(resolve("dist"))) {
  await app.register(fastifyStatic, { root: resolve("dist"), wildcard: false });
  app.get("/system-status", async (_request, reply) =>
    reply.sendFile("index.html"),
  );
}
await app.listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" });
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
