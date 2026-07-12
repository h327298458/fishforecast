import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { haversineKm } from "./bomOfficialTide.js";
import { markHealth } from "../services/health.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) =>
    ["item", "station", "period", "level", "element"].includes(name),
});
const stateCodes: Record<string, { warning: string; observation: string }> = {
  NSW: { warning: "IDZ00054", observation: "IDN60920" },
  QLD: { warning: "IDZ00056", observation: "IDQ60920" },
  VIC: { warning: "IDZ00059", observation: "IDV60920" },
  WA: { warning: "IDZ00060", observation: "IDW60920" },
  SA: { warning: "IDZ00057", observation: "IDS60920" },
  TAS: { warning: "IDZ00058", observation: "IDT60920" },
  NT: { warning: "IDZ00055", observation: "IDD60920" },
  ACT: { warning: "IDZ00051", observation: "IDN60920" },
};
type Cached = { text: string; generatedAtUtc: string; expiresAt: number };
const cache = new Map<string, Cached>();

async function bomText(url: string, ttlMs: number, healthKey: string) {
  const now = Date.now(),
    cached = cache.get(url);
  if (cached && cached.expiresAt > now) return { ...cached, stale: false };
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "TideLine personal fishing decision system" },
    });
    if (!response.ok) throw new Error(`BOM_HTTP_${response.status}`);
    const text = await response.text();
    const item = {
      text,
      generatedAtUtc: new Date().toISOString(),
      expiresAt: now + ttlMs,
    };
    cache.set(url, item);
    markHealth(healthKey, true);
    return { ...item, stale: false };
  } catch (error) {
    markHealth(healthKey, false, error);
    if (cached) return { ...cached, stale: true };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export type BomWarning = {
  warningId: string;
  provider: "BOM";
  productCode: string | null;
  warningType: string;
  title: string;
  severity: "minor" | "moderate" | "severe";
  issuedAtUtc: string;
  validFromUtc: string | null;
  validUntilUtc: string | null;
  state: string;
  forecastDistrict: string | null;
  marineZone: string | null;
  affectedAreaText: string;
  sourceUrl: string;
  rawPayload: string;
  fetchedAtUtc: string;
};
export const classifyBomWarning = (title: string) =>
  [
    "Storm Force Wind Warning",
    "Gale Warning",
    "Strong Wind Warning",
    "Hazardous Surf",
    "Severe Thunderstorm Warning",
    "Severe Weather Warning",
    "Flood Warning",
    "Tropical Cyclone Warning",
    "Abnormally High Tides",
    "Damaging Waves",
  ].find((type) => title.toLowerCase().includes(type.toLowerCase())) ??
  "Other BOM Warning";
export const bomWarningSeverity = (type: string): BomWarning["severity"] =>
  /storm force|tropical cyclone|severe thunderstorm|severe weather|damaging waves/i.test(
    type,
  )
    ? "severe"
    : /gale|hazardous surf|flood|abnormally high/i.test(type)
      ? "moderate"
      : "minor";
export async function getBomWarnings(state: string) {
  const code = stateCodes[state]?.warning;
  if (!code) throw new Error("BOM_WARNING_STATE_UNSUPPORTED");
  const url = `https://www.bom.gov.au/fwo/${code}.warnings_${state.toLowerCase()}.xml`,
    fetched = await bomText(url, 10 * 60_000, "warnings");
  const document = parser.parse(fetched.text),
    items = document?.rss?.channel?.item ?? [];
  const warnings: BomWarning[] = items.map((item: Record<string, unknown>) => {
    const title = String(item.title ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      link = String(item.link ?? ""),
      type = classifyBomWarning(title);
    const productCode = link.match(/(ID[A-Z]\d+)/)?.[1] ?? null;
    const guid = item.guid as Record<string, unknown> | string | undefined;
    return {
      warningId: String(
        typeof guid === "object"
          ? guid["#text"]
          : (guid ??
              createHash("sha1")
                .update(`${title}|${item.pubDate}`)
                .digest("hex")),
      ),
      provider: "BOM" as const,
      productCode,
      warningType: type,
      title,
      severity: bomWarningSeverity(type),
      issuedAtUtc: new Date(String(item.pubDate)).toISOString(),
      validFromUtc: null,
      validUntilUtc: null,
      state,
      forecastDistrict: title.match(/for (.+?)(?:\.|$)/i)?.[1] ?? null,
      marineZone: /marine|waters|coast/i.test(title) ? title : null,
      affectedAreaText: title,
      sourceUrl: link.replace("http://", "https://"),
      rawPayload: JSON.stringify(item),
      fetchedAtUtc: fetched.generatedAtUtc,
    };
  });
  return {
    warnings,
    sourceUrl: url,
    fetchedAtUtc: fetched.generatedAtUtc,
    usingStaleCache: fetched.stale,
    matchPrecision: "STATE_OR_TEXT_AREA" as const,
  };
}

type BomObservation = {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  observedAtUtc: string;
  temperatureC: number | null;
  windSpeedKmh: number | null;
  gustKmh: number | null;
  windDirectionDeg: number | null;
  pressureHpa: number | null;
  rainSince9amMm: number | null;
  distanceKm: number;
  sourceUrl: string;
  fetchedAtUtc: string;
  usingStaleCache: boolean;
};
const numberOrNull = (value: unknown) =>
  value === undefined || value === null || value === "" ? null : Number(value);
export async function getBomObservation(
  point: { latitude: number; longitude: number },
  state: string,
): Promise<{ selected: BomObservation | null; candidates: BomObservation[] }> {
  const code = stateCodes[state]?.observation;
  if (!code) throw new Error("BOM_OBSERVATION_STATE_UNSUPPORTED");
  const url = `https://www.bom.gov.au/fwo/${code}.xml`,
    fetched = await bomText(url, 10 * 60_000, "observations");
  const stations =
    parser.parse(fetched.text)?.product?.observations?.station ?? [];
  const candidates = stations
    .map((station: Record<string, unknown>) => {
      const period = (station.period as Array<Record<string, unknown>>)?.[0];
      const level = (period?.level as Array<Record<string, unknown>>)?.[0];
      const elements = (level?.element as Array<Record<string, unknown>>) ?? [];
      const element = (type: string) =>
        elements.find((entry) => entry["@_type"] === type)?.["#text"];
      const latitude = Number(station["@_lat"]),
        longitude = Number(station["@_lon"]);
      return {
        stationId: String(station["@_bom-id"] ?? station["@_wmo-id"]),
        stationName: String(station["@_stn-name"]),
        latitude,
        longitude,
        observedAtUtc: new Date(String(period?.["@_time-utc"])).toISOString(),
        temperatureC: numberOrNull(element("air_temperature")),
        windSpeedKmh: numberOrNull(element("wind_spd_kmh")),
        gustKmh: numberOrNull(element("gust_kmh")),
        windDirectionDeg: numberOrNull(element("wind_dir_deg")),
        pressureHpa: numberOrNull(element("msl_pres") ?? element("pres")),
        rainSince9amMm: numberOrNull(element("rainfall")),
        distanceKm: haversineKm(point, { latitude, longitude }),
        sourceUrl: url,
        fetchedAtUtc: fetched.generatedAtUtc,
        usingStaleCache: fetched.stale,
      };
    })
    .filter(
      (item: BomObservation) =>
        Date.now() - new Date(item.observedAtUtc).getTime() < 2 * 60 * 60_000 &&
        item.windSpeedKmh !== null,
    )
    .sort(
      (a: BomObservation, b: BomObservation) =>
        observationRank(a, point) - observationRank(b, point),
    )
    .slice(0, 5);
  return { selected: candidates[0] ?? null, candidates };
}
function observationRank(
  item: BomObservation,
  point: { latitude: number; longitude: number },
) {
  const ageMinutes =
    (Date.now() - new Date(item.observedAtUtc).getTime()) / 60_000;
  const completenessPenalty =
    [item.windSpeedKmh, item.gustKmh, item.pressureHpa].filter(
      (x) => x === null,
    ).length * 18;
  const airportPenalty =
    /AIRPORT/i.test(item.stationName) && Math.abs(point.latitude) < 40 ? 5 : 0;
  return (
    item.distanceKm + ageMinutes * 0.15 + completenessPenalty + airportPenalty
  );
}

const marineProducts: Record<string, string> = {
  NSW: "IDN11001",
  QLD: "IDQ11290",
  VIC: "IDV10200",
  WA: "IDW11160",
  SA: "IDS11072",
  TAS: "IDT12329",
  NT: "IDD11030",
};
export async function getBomMarineForecast(
  point: { latitude: number; longitude: number },
  state: string,
) {
  let productCode = marineProducts[state];
  let zone = `${state} Coastal Waters`;
  if (
    state === "NSW" &&
    point.latitude > -34.25 &&
    point.latitude < -33.45 &&
    point.longitude > 150.8
  ) {
    productCode = point.longitude < 151.25 ? "IDN11013" : "IDN11009";
    zone =
      productCode === "IDN11013"
        ? "Sydney Enclosed Waters"
        : "Sydney Coastal Waters";
  }
  if (
    state === "QLD" &&
    point.latitude > -28.4 &&
    point.latitude < -27.2 &&
    point.longitude > 153
  ) {
    productCode = "IDQ11311";
    zone = "Gold Coast Waters: Cape Moreton to Point Danger";
  }
  if (!productCode) throw new Error("BOM_MARINE_STATE_UNSUPPORTED");
  const sourceUrl = `https://www.bom.gov.au/fwo/${productCode}.txt`,
    fetched = await bomText(sourceUrl, 45 * 60_000, "marineForecast");
  return {
    provider: "BOM",
    productCode,
    zone,
    text: fetched.text.trim(),
    sourceUrl,
    fetchedAtUtc: fetched.generatedAtUtc,
    usingStaleCache: fetched.stale,
    precision: "OFFICIAL_ZONE_TEXT_NOT_HOURLY" as const,
  };
}
