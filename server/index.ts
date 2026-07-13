import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
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
import { authenticate, createInvitation, createSession, deleteSession, getSessionUser, listInvitations, registerWithInvitation, revokeInvitation, seedInitialAdmin, type AuthUser } from "./auth.js";

const app = Fastify({ logger: true });
const allowedOrigins = new Set((process.env.ALLOWED_ORIGIN ?? "http://localhost:5173").split(",").map((value) => value.trim()).filter(Boolean));
await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    // Same-origin production requests do not need CORS.  Explicitly permit only
    // the local Vite origin or deployment origins configured by the operator.
    callback(null, !origin || allowedOrigins.has(origin));
  },
});
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });
const dbPath = process.env.DATABASE_PATH ?? "./data/tideline.db";
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
applyMigrations(db);
const seededAdmin = seedInitialAdmin(db);
if (seededAdmin) app.log.info({ username: seededAdmin.username }, "initial administrator created");
const geocoder = new PhotonGeocoding();

const sessionCookieName = "tideline_session";
const secureCookies = process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE === undefined && process.env.NODE_ENV === "production");
const parseCookies = (request: FastifyRequest) => {
  const cookies: Record<string, string> = {};
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1)); } catch { /* Ignore malformed cookie values. */ }
  }
  return cookies;
};
const currentUser = (request: FastifyRequest) => getSessionUser(db, parseCookies(request)[sessionCookieName]);
const sendSessionCookie = (reply: FastifyReply, token: string, expiresAtUtc: string) => reply.header("set-cookie", `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((new Date(expiresAtUtc).getTime() - Date.now()) / 1000))}${secureCookies ? "; Secure" : ""}`);
const clearSessionCookie = (reply: FastifyReply) => reply.header("set-cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? "; Secure" : ""}`);
const requireUser = (request: FastifyRequest, reply: FastifyReply): AuthUser | null => {
  const user = currentUser(request);
  if (user) return user;
  reply.code(401).send({ status: "unauthenticated", reason: "AUTH_REQUIRED", data: null });
  return null;
};
const requireAdmin = (request: FastifyRequest, reply: FastifyReply) => {
  const user = requireUser(request, reply);
  if (!user || user.role !== "ADMIN") {
    if (user) reply.code(403).send({ status: "forbidden", reason: "ADMIN_REQUIRED", data: null });
    return null;
  }
  return user;
};
const requireSameOrigin = (request: FastifyRequest, reply: FastifyReply) => {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers.host;
  if (origin === `http://${host}` || origin === `https://${host}` || allowedOrigins.has(origin)) return true;
  reply.code(403).send({ status: "forbidden", reason: "ORIGIN_NOT_ALLOWED", data: null });
  return false;
};

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
app.get("/api/auth/me", async (request) => {
  const user = currentUser(request);
  return user ? { authenticated: true, user } : { authenticated: false, user: null };
});
app.post("/api/auth/login", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  const body = request.body as Record<string, unknown>;
  const user = authenticate(db, body?.username, body?.password);
  if (!user) return reply.code(401).send({ status: "unauthenticated", reason: "INVALID_CREDENTIALS", data: null });
  const session = createSession(db, user.id);
  sendSessionCookie(reply, session.token, session.expiresAtUtc);
  return { authenticated: true, user };
});
app.post("/api/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  try {
    const body = request.body as Record<string, unknown>;
    const user = registerWithInvitation(db, body ?? {});
    const session = createSession(db, user.id);
    sendSessionCookie(reply, session.token, session.expiresAtUtc);
    return reply.code(201).send({ authenticated: true, user });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "REGISTRATION_FAILED";
    return reply.code(reason === "USERNAME_TAKEN" ? 409 : 400).send({ status: "invalid", reason, data: null });
  }
});
app.post("/api/auth/logout", async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  deleteSession(db, parseCookies(request)[sessionCookieName]);
  clearSessionCookie(reply);
  return { status: "signed_out" };
});
app.get("/api/admin/invitations", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  return { invitations: listInvitations(db) };
});
app.post("/api/admin/invitations", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  const admin = requireAdmin(request, reply);
  if (!admin) return;
  try {
    const invitation = createInvitation(db, admin.id, (request.body as Record<string, unknown>) ?? {});
    return reply.code(201).send({ invitation });
  } catch (error) {
    return reply.code(400).send({ status: "invalid", reason: error instanceof Error ? error.message : "INVITATION_CREATE_FAILED", data: null });
  }
});
app.post("/api/admin/invitations/:id/revoke", async (request, reply) => {
  if (!requireSameOrigin(request, reply) || !requireAdmin(request, reply)) return;
  const id = String((request.params as { id: string }).id ?? "");
  return revokeInvitation(db, id) ? { status: "revoked", id } : reply.code(404).send({ status: "not_found", data: null });
});
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
  const authenticatedUser = currentUser(req);
  const requestedSpotId = q.spotId ?? "";
  if (requestedSpotId) {
    const ownedSpot = db.prepare("SELECT owner_user_id FROM spots WHERE id=?").get(requestedSpotId) as { owner_user_id: string | null } | undefined;
    if (ownedSpot && ownedSpot.owner_user_id !== authenticatedUser?.id)
      return reply.code(404).send({ status: "not_found", data: null });
  }
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
  const spotId = requestedSpotId;
  if (spotId && authenticatedUser && db.prepare("SELECT 1 FROM spots WHERE id=? AND owner_user_id=?").get(spotId, authenticatedUser.id)) {
    snapshotId = randomUUID();
    const snapshot = {
      generatedAtUtc: forecast.generatedAtUtc,
      spot: forecast.spot,
      tides: forecast.tides,
      warnings: forecast.warnings,
      observation: forecast.observation,
      bomMarineForecast: forecast.bomMarineForecast,
      nswMhlWave: forecast.nswMhlWave,
      marineApplicability: forecast.marineApplicability,
      rainfallContext: forecast.rainfallContext,
      waterData: forecast.waterData,
      providerStatus: forecast.providerStatus,
      days: forecast.days.map((day) => ({ date: day.date, windows: day.windows, scores: day.hours.map((hour) => ({ timestampUtc: hour.timestampUtc, score: hour.score, tideHeightM: hour.tideHeightM, tidePhase: hour.tidePhase })) })),
    };
    db.prepare("INSERT INTO forecast_snapshots (id,spot_id,rule_version,payload_json,created_at_utc) VALUES (?,?,?,?,?)").run(snapshotId, spotId, RULE_VERSION, JSON.stringify(snapshot), new Date().toISOString());
  }
  return { ...forecast, snapshotId };
});
app.get("/api/tides/eot20",async(req,reply)=>{const q=req.query as Record<string,string>;const latitude=Number(q.lat),longitude=Number(q.lon),intervalMinutes=Number(q.intervalMinutes??60);if(!inAustralia(latitude,longitude)||!Number.isFinite(intervalMinutes)||intervalMinutes<10)return reply.code(400).send({status:"invalid",reason:"INVALID_TIDE_QUERY",provider:"EOT20"});const start=q.startUtc?new Date(q.startUtc):new Date();if(Number.isNaN(start.getTime()))return reply.code(400).send({status:"invalid",reason:"INVALID_TIDE_START",provider:"EOT20"});if(!q.startUtc)start.setUTCMinutes(0,0,0);const end=q.endUtc?new Date(q.endUtc):new Date(start.getTime()+7*86400000);if(Number.isNaN(end.getTime())||end<=start)return reply.code(400).send({status:"invalid",reason:"INVALID_TIDE_END",provider:"EOT20"});try{const data=await calculateEot20({latitude,longitude,startUtc:start.toISOString(),endUtc:end.toISOString(),intervalMinutes,spotType:q.spotType??"beach",waterType:q.waterType});return{status:"available",provider:"EOT20",data};}catch(error){const reason=error instanceof Error?error.message:"EOT20_FAILED";return reply.code(reason==="EOT20_NOT_APPLICABLE"?422:503).send({status:"unavailable",reason,provider:"EOT20"});}});
app.get("/api/spots", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return db
    .prepare(
      "SELECT s.id,s.name,COALESCE(s.address,'') AS address,s.latitude,s.longitude,s.state,s.timezone,s.spot_type AS spotType,s.water_type AS waterType,s.fishing_method AS fishingMethod,s.target_species AS targetSpecies,s.allow_night AS allowNight,s.created_at_utc AS createdAtUtc,COALESCE(p.preferred_tide_source,'BOM_OFFICIAL') AS preferredTideSource FROM spots s LEFT JOIN spot_environment_preferences p ON p.spot_id=s.id WHERE s.owner_user_id=? ORDER BY s.created_at_utc DESC",
    )
    .all(user.id);
});
app.get("/api/spots/:id", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return;
  const { id } = req.params as { id: string };
  const spot = db
    .prepare(
      "SELECT id,name,COALESCE(address,'') AS address,latitude,longitude,state,timezone,spot_type AS spotType,water_type AS waterType,fishing_method AS fishingMethod,target_species AS targetSpecies,allow_night AS allowNight,created_at_utc AS createdAtUtc FROM spots WHERE id=? AND owner_user_id=?",
    )
    .get(id, user.id);
  return spot ?? reply.code(404).send({ status: "not_found", data: null });
});
app.post("/api/spots", async (req, reply) => {
  if (!requireSameOrigin(req, reply)) return;
  const user = requireUser(req, reply);
  if (!user) return;
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
  const existing = db.prepare("SELECT owner_user_id FROM spots WHERE id=?").get(id) as { owner_user_id: string | null } | undefined;
  if (existing && existing.owner_user_id !== user.id)
    return reply.code(404).send({ status: "not_found", data: null });
  db.prepare(
    `INSERT INTO spots (id,name,address,latitude,longitude,state,timezone,spot_type,water_type,fishing_method,target_species,allow_night,created_at_utc,owner_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,state=excluded.state,timezone=excluded.timezone,spot_type=excluded.spot_type,water_type=excluded.water_type,fishing_method=excluded.fishing_method,target_species=excluded.target_species,allow_night=excluded.allow_night`,
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
    user.id,
  );
  return reply
    .code(201)
    .send(
      db
        .prepare(
          "SELECT id,name,address,latitude,longitude,state,timezone,spot_type AS spotType,fishing_method AS fishingMethod FROM spots WHERE id=? AND owner_user_id=?",
        )
        .get(id, user.id),
    );
});
app.put("/api/spots/:id/environment-preferences", async (req, reply) => {
  if (!requireSameOrigin(req, reply)) return;
  const user = requireUser(req, reply);
  if (!user) return;
  const { id } = req.params as { id: string };
  const spot = db.prepare("SELECT latitude,longitude,state FROM spots WHERE id=? AND owner_user_id=?").get(id, user.id) as {latitude:number;longitude:number;state:string}|undefined;
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
app.get("/api/logs", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return db
    .prepare(
      "SELECT l.id,l.spot_id AS spotId,l.forecast_snapshot_id AS forecastSnapshotId,l.started_at_utc AS startedAtUtc,l.ended_at_utc AS endedAtUtc,l.method,l.bait,l.bites,l.catches,l.kept,l.rating,l.gear_issues AS gearIssues,l.notes,l.details_json AS detailsJson,l.comparison_json AS comparisonJson,l.created_at_utc AS createdAtUtc FROM fishing_logs l JOIN spots s ON s.id=l.spot_id WHERE s.owner_user_id=? ORDER BY l.started_at_utc DESC LIMIT 100",
    )
    .all(user.id);
});
app.post("/api/logs", async (req, reply) => {
  if (!requireSameOrigin(req, reply)) return;
  const user = requireUser(req, reply);
  if (!user) return;
  const b = req.body as Record<string, unknown>;
  const spotId = String(b.spotId ?? "");
  if (!spotId || !db.prepare("SELECT 1 FROM spots WHERE id=? AND owner_user_id=?").get(spotId, user.id))
    return reply
      .code(409)
      .send({
        status: "invalid",
        reason: "SPOT_MUST_BE_SAVED_FIRST",
        data: null,
      });
  const id = randomUUID(),
    now = new Date().toISOString();
  const detailKeys = ["effectiveMinutes","blank","species","maxLengthCm","maxWeightKg","lure","waterDepth","castingDistanceM","moveCount","snagCount","tangleCount","lineBreakCount","baitLossCount","boatTraffic","crowdTraffic","weatherInterrupted"];
  const details = Object.fromEntries(detailKeys.filter((key) => b[key] !== undefined).map((key) => [key, b[key]]));
  const gearProblem = Boolean(Number(b.snagCount ?? 0) || Number(b.tangleCount ?? 0) || Number(b.lineBreakCount ?? 0) || Number(b.baitLossCount ?? 0));
  const snapshot = b.forecastSnapshotId ? db.prepare("SELECT fs.payload_json FROM forecast_snapshots fs JOIN spots s ON s.id=fs.spot_id WHERE fs.id=? AND s.owner_user_id=?").get(String(b.forecastSnapshotId), user.id) as { payload_json?: string } | undefined : undefined;
  const comparison = { snapshotAvailable: Boolean(snapshot), actualBites: Number(b.bites ?? 0), actualCatches: Number(b.catches ?? 0), blank: Boolean(b.blank), trainingEligible: !gearProblem, reason: gearProblem ? "EQUIPMENT_ISSUES_PRESENT" : "ENVIRONMENT_RESULT_ELIGIBLE", tideSource: snapshot ? JSON.parse(String(snapshot.payload_json ?? "{}")).tides?.actualTideSourceUsed ?? null : null };
  db.prepare(
    "INSERT INTO fishing_logs (id,spot_id,forecast_snapshot_id,started_at_utc,ended_at_utc,method,bait,bites,catches,kept,rating,gear_issues,notes,created_at_utc,details_json,comparison_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    spotId,
    b.forecastSnapshotId ?? null,
    String(b.startedAtUtc), String(b.endedAtUtc), String(b.method ?? "bottom_fishing"), b.bait ?? null, Number(b.bites ?? 0), Number(b.catches ?? 0), Number(b.kept ?? 0), Number(b.rating ?? 3), b.gearIssues ?? null, b.notes ?? null,
    now,
    JSON.stringify(details),
    JSON.stringify(comparison),
  );
  return reply.code(201).send({ id });
});
app.get("/api/analytics", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const row = db
    .prepare(
      "SELECT COUNT(*) sessions, COALESCE(SUM(l.catches),0) catches, COALESCE(SUM(l.bites),0) bites, COALESCE(AVG(l.rating),0) rating, COALESCE(SUM(CASE WHEN l.catches=0 THEN 1 ELSE 0 END),0) blanks FROM fishing_logs l JOIN spots s ON s.id=l.spot_id WHERE s.owner_user_id=?",
    )
    .get(user.id) as {
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
