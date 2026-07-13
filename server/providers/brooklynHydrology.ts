import { haversineKm } from "./bomOfficialTide.js";
import { markHealth } from "../services/health.js";

const BROOKLYN = { latitude: -33.5477, longitude: 151.227 };
const SPENCER = {
  sitecode: "212431",
  sensorId: "98907042",
  stationName: "Spencer — Hawkesbury River",
  latitude: -33.4571376821,
  longitude: 151.1468412422,
};
const NORTH_RICHMOND = { latitude: -33.58930125, longitude: 150.71403109 };
type Cached = { value: BrooklynHydrology; expiresAt: number };
let cache: Cached | null = null;
export const clearBrooklynHydrologyCache = () => { cache = null; };
export type BrooklynHydrology = {
  status: "PARTIAL" | "NOT_APPLICABLE";
  provider: "NSW_MHL_WATER";
  stationName?: string;
  stationCode?: string;
  stationLatitude?: number;
  stationLongitude?: number;
  distanceToSpotKm?: number;
  observedAtUtc?: string;
  waterLevelM?: number;
  datum?: string | null;
  change24hM?: number | null;
  change72hM?: number | null;
  trend?: "RISING" | "FALLING" | "STEADY" | "UNKNOWN";
  flowM3s?: null;
  upstreamRain?: {
    source: "Open-Meteo model/analysis";
    referenceArea: string;
    past24hMm: number;
    past72hMm: number;
    future24hMm: number;
  };
  sourceUrl?: string;
  fetchedAtUtc: string;
  usingStaleCache: boolean;
  limitation: string;
};
const mhlUtc = (local: string) => new Date(`${local.replace(" ", "T")}+10:00`);
const yyyyMmDd = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Sydney" }).format(date);
const nearestReading = (readings: Array<{ time: Date; value: number }>, target: Date) =>
  readings.reduce<{ time: Date; value: number } | null>(
    (best, item) =>
      !best || Math.abs(item.time.getTime() - target.getTime()) < Math.abs(best.time.getTime() - target.getTime())
        ? item
        : best,
    null,
  );
async function upstreamRain(now: Date, signal: AbortSignal) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(NORTH_RICHMOND.latitude),
    longitude: String(NORTH_RICHMOND.longitude),
    timezone: "UTC",
    past_days: "3",
    forecast_days: "2",
    hourly: "precipitation",
  }).toString();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`UPSTREAM_RAIN_HTTP_${response.status}`);
  const data = (await response.json()) as { hourly: { time: string[]; precipitation: Array<number | null> } };
  const rows = data.hourly.time.map((time, index) => ({ time: new Date(`${time}Z`).getTime(), value: data.hourly.precipitation[index] ?? 0 }));
  const sum = (from: number, to: number) => Number(rows.filter((row) => row.time >= from && row.time < to).reduce((total, row) => total + row.value, 0).toFixed(1));
  return {
    source: "Open-Meteo model/analysis" as const,
    referenceArea: "North Richmond / upper Hawkesbury reference point",
    past24hMm: sum(now.getTime() - 24 * 3_600_000, now.getTime()),
    past72hMm: sum(now.getTime() - 72 * 3_600_000, now.getTime()),
    future24hMm: sum(now.getTime(), now.getTime() + 24 * 3_600_000),
  };
}
export function brooklynHydrologyApplicable(point: { latitude: number; longitude: number }) {
  return haversineKm(point, BROOKLYN) <= 50;
}
export async function getBrooklynHydrology(point: { latitude: number; longitude: number }): Promise<BrooklynHydrology> {
  if (!brooklynHydrologyApplicable(point))
    return { status: "NOT_APPLICABLE", provider: "NSW_MHL_WATER", fetchedAtUtc: new Date().toISOString(), usingStaleCache: false, limitation: "Initial hydrology scope is Brooklyn / lower Hawkesbury only." };
  if (cache && cache.expiresAt > Date.now())
    return { ...cache.value, distanceToSpotKm: haversineKm(point, SPENCER), usingStaleCache: false };
  const root = "https://api.manly.hydraulics.works/api.php";
  const latestUrl = `${root}?page=latest-readings&sitecode=${SPENCER.sitecode}&username=publicwww`;
  const now = new Date();
  const rawUrl = `${root}?page=rawdatatable&id=${SPENCER.sensorId}&startdate=${yyyyMmDd(new Date(now.getTime() - 4 * 86_400_000))}&enddate=${yyyyMmDd(new Date(now.getTime() + 86_400_000))}&username=publicwww`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const [latestResponse, rawResponse, upstreamRainfall] = await Promise.all([
      fetch(latestUrl, { signal: controller.signal }),
      fetch(rawUrl, { signal: controller.signal }),
      upstreamRain(now, controller.signal),
    ]);
    if (!latestResponse.ok) throw new Error(`NSW_MHL_LATEST_HTTP_${latestResponse.status}`);
    if (!rawResponse.ok) throw new Error(`NSW_MHL_HISTORY_HTTP_${rawResponse.status}`);
    const latest = (await latestResponse.json()) as Record<string, { obsdate?: string; value?: unknown }>;
    const current = latest[SPENCER.sensorId];
    const level = Array.isArray(current?.value) ? Number(current.value[0]) : Number.NaN;
    if (!current?.obsdate || !Number.isFinite(level)) throw new Error("NSW_MHL_WATER_LEVEL_MISSING");
    const raw = (await rawResponse.json()) as { summary?: Record<string, { datum?: string }>; readings?: Record<string, Record<string, unknown>> };
    const readings = Object.entries(raw.readings ?? {})
      .map(([time, row]) => ({ time: mhlUtc(time), value: Number(row[SPENCER.sensorId]) }))
      .filter((row) => Number.isFinite(row.value));
    const observedAt = mhlUtc(current.obsdate);
    const change = (hours: number) => {
      const old = nearestReading(readings, new Date(observedAt.getTime() - hours * 3_600_000));
      return old ? Number((level - old.value).toFixed(3)) : null;
    };
    const change24hM = change(24), change72hM = change(72);
    const trend = change24hM === null ? "UNKNOWN" : change24hM > 0.03 ? "RISING" : change24hM < -0.03 ? "FALLING" : "STEADY";
    const value: BrooklynHydrology = {
      status: "PARTIAL",
      provider: "NSW_MHL_WATER",
      stationName: SPENCER.stationName,
      stationCode: SPENCER.sitecode,
      stationLatitude: SPENCER.latitude,
      stationLongitude: SPENCER.longitude,
      distanceToSpotKm: haversineKm(point, SPENCER),
      observedAtUtc: observedAt.toISOString(),
      waterLevelM: level,
      datum: raw.summary?.[SPENCER.sensorId]?.datum ?? null,
      change24hM,
      change72hM,
      trend,
      flowM3s: null,
      upstreamRain: upstreamRainfall,
      sourceUrl: rawUrl,
      fetchedAtUtc: new Date().toISOString(),
      usingStaleCache: false,
      limitation: "This lower-Hawkesbury level gauge is tidally influenced and no discharge/flow series is published by this public route. Use it as water-level context, not as freshwater flow or fish-activity evidence.",
    };
    cache = { value, expiresAt: Date.now() + 15 * 60_000 };
    markHealth("waterData", true);
    return value;
  } catch (error) {
    markHealth("waterData", false, error);
    if (cache) return { ...cache.value, distanceToSpotKm: haversineKm(point, SPENCER), usingStaleCache: true };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
