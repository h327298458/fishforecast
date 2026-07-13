import { haversineKm } from "./bomOfficialTide.js";
import { markHealth } from "../services/health.js";

type Coordinates = { latitude: number; longitude: number };
type MhlStation = Coordinates & { sitecode: string; stationName: string };
const stations: MhlStation[] = [
  { sitecode: "BYRBOW", stationName: "Byron Bay offshore wave buoy", latitude: -28.85388888, longitude: 153.70194445 },
  { sitecode: "COFHOW", stationName: "Coffs Harbour offshore wave buoy", latitude: -30.37277778, longitude: 153.25888893 },
  { sitecode: "CRHDOW", stationName: "Crowdy Head offshore wave buoy", latitude: -31.82527778, longitude: 152.85972218 },
  { sitecode: "SYDDOW", stationName: "Sydney offshore wave buoy", latitude: -33.76888892, longitude: 151.41194444 },
  { sitecode: "PTKMOW", stationName: "Port Kembla offshore wave buoy", latitude: -34.47194444, longitude: 151.02166667 },
  { sitecode: "BATBOW", stationName: "Batemans Bay offshore wave buoy", latitude: -35.70305558, longitude: 150.34388891 },
  { sitecode: "EDENOW", stationName: "Eden offshore wave buoy", latitude: -37.35811108, longitude: 150.19825003 },
];
type Cached = { value: NswMhlWaveObservation; expiresAt: number };
const cache = new Map<string, Cached>();

export type WaveApplicability = "APPLICABLE" | "LOW_CONFIDENCE" | "NOT_APPLICABLE";
export type NswMhlWaveObservation = {
  provider: "NSW_MHL";
  stationName: string;
  stationCode: string;
  stationLatitude: number;
  stationLongitude: number;
  distanceToSpotKm: number;
  observationTimeUtc: string;
  significantWaveHeightM: number | null;
  maximumWaveHeightM: number | null;
  wavePeriodSeconds: number | null;
  waveDirectionDeg: number | null;
  seaTemperatureC: number | null;
  applicability: WaveApplicability;
  applicabilityReason: string;
  sourceUrl: string;
  fetchedAtUtc: string;
  usingStaleCache: boolean;
};
const numeric = (value: unknown) => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
};
export function mhlApplicability(
  spotType: string,
  waterType = "",
): Pick<NswMhlWaveObservation, "applicability" | "applicabilityReason"> {
  if (spotType === "freshwater" || /fresh/i.test(waterType))
    return { applicability: "NOT_APPLICABLE", applicabilityReason: "Freshwater location: offshore NSW buoy data is not applicable." };
  if (/harbour|estuary|river|enclosed|bay/i.test(waterType) || ["wharf", "estuary"].includes(spotType))
    return { applicability: "LOW_CONFIDENCE", applicabilityReason: "Offshore deep-water buoy is regional sea-state context only; it is not shore-side conditions inside a harbour or estuary." };
  return { applicability: "APPLICABLE", applicabilityReason: "Nearest offshore deep-water buoy is relevant regional context, not a measurement at the fishing position." };
}
export async function getNswMhlWaveObservation(
  point: Coordinates,
  spotType: string,
  waterType = "",
): Promise<NswMhlWaveObservation> {
  const station = [...stations].sort(
    (a, b) => haversineKm(point, a) - haversineKm(point, b),
  )[0];
  const cached = cache.get(station.sitecode);
  const applicability = mhlApplicability(spotType, waterType);
  if (cached && cached.expiresAt > Date.now())
    return {
      ...cached.value,
      ...applicability,
      distanceToSpotKm: haversineKm(point, station),
      usingStaleCache: false,
    };
  const sourceUrl = `https://api.manly.hydraulics.works/api.php?page=latest-readings&sitecode=${station.sitecode}&username=publicwww`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`NSW_MHL_HTTP_${response.status}`);
    const readings = (await response.json()) as Record<string, { name?: string; unit_type?: string; obsdate?: string; value?: unknown }>;
    const find = (pattern: RegExp) =>
      Object.values(readings).find((reading) =>
        pattern.test(`${reading.name ?? ""} ${reading.unit_type ?? ""}`),
      );
    const height = find(/(^|\s)Hs(\s|$)|wave height/i);
    const maximum = find(/maximum wave|max wave|Hmax/i);
    const period = find(/wave period|TP1/i);
    const direction = find(/wave direction/i);
    const temperature = find(/sea temp|sea temperature/i);
    if (!height || numeric(height.value) === null || !height.obsdate)
      throw new Error("NSW_MHL_REQUIRED_WAVE_HEIGHT_MISSING");
    const value: NswMhlWaveObservation = {
      provider: "NSW_MHL",
      stationName: station.stationName,
      stationCode: station.sitecode,
      stationLatitude: station.latitude,
      stationLongitude: station.longitude,
      distanceToSpotKm: haversineKm(point, station),
      observationTimeUtc: new Date(`${height.obsdate.replace(" ", "T")}+10:00`).toISOString(),
      significantWaveHeightM: numeric(height.value),
      maximumWaveHeightM: numeric(maximum?.value),
      wavePeriodSeconds: numeric(period?.value),
      waveDirectionDeg: numeric(direction?.value),
      seaTemperatureC: numeric(temperature?.value),
      ...applicability,
      sourceUrl,
      fetchedAtUtc: new Date().toISOString(),
      usingStaleCache: false,
    };
    cache.set(station.sitecode, { value, expiresAt: Date.now() + 10 * 60_000 });
    markHealth("nswMhlWave", true);
    return value;
  } catch (error) {
    markHealth("nswMhlWave", false, error);
    if (cached)
      return {
        ...cached.value,
        ...applicability,
        distanceToSpotKm: haversineKm(point, station),
        usingStaleCache: true,
      };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
