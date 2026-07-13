import type Database from "better-sqlite3";
import { OpenMeteoMarine, OpenMeteoWeather } from "../providers/openMeteo.js";
import {
  getBomMarineForecast,
  getBomObservation,
  getBomWarnings,
  matchBomWarnings,
  warningOverlapsWindow,
} from "../providers/bom.js";
import {
  calculateEot20,
  eot20Applicability,
  eot20Status,
} from "../providers/eot20.js";
import {
  nearestOfficialStations,
  officialEvents,
} from "../providers/bomOfficialTide.js";
import { scoreHour, mergeWindows, RULE_VERSION } from "../domain/scoring.js";
import type { HourlyEnvironment } from "../domain/types.js";
import {
  getRainContext,
  localAstronomy,
} from "../providers/environmentContext.js";
import { getNswMhlWaveObservation } from "../providers/nswMhlWave.js";
import { getBrooklynHydrology } from "../providers/brooklynHydrology.js";

const baseSpot = {
  id: "selected-location",
  name: "Selected location",
  address: "",
  latitude: -33.86,
  longitude: 151.21,
  state: "NSW",
  timezone: "Australia/Sydney",
  spotType: "wharf",
  waterType: "estuary_or_harbour",
  fishingMethod: "bottom_fishing",
  preferredTideSource: "BOM_OFFICIAL",
};
type Input = Partial<typeof baseSpot>;
const canonicalTideSource = (value: unknown) =>
  ({ OFFICIAL: "BOM_OFFICIAL", EOT20: "EOT20_MODEL", NONE: "NO_TIDE" })[
    String(value).toUpperCase()
  ] ?? String(value).toUpperCase();
const marineApplicability = (spotType: string, waterType: string) =>
  spotType === "freshwater" || /freshwater/i.test(waterType)
    ? "NOT_APPLICABLE"
    : ["estuary", "wharf"].includes(spotType) ||
        /harbour|estuary|river|bay|enclosed/i.test(waterType)
      ? "LOW_CONFIDENCE"
      : "APPLICABLE";

export async function buildForecast(input: Input = {}, db?: Database.Database) {
  const spot = { ...baseSpot, ...input };
  const point = { latitude: spot.latitude, longitude: spot.longitude };
  const start = new Date(),
    end = new Date(start.getTime() + 7 * 86_400_000);
  const weatherProvider = new OpenMeteoWeather(),
    marineProvider = new OpenMeteoMarine();
  const preference =
    db && !String(spot.id).startsWith("draft")
      ? (db
          .prepare("SELECT * FROM spot_environment_preferences WHERE spot_id=?")
          .get(spot.id) as Record<string, unknown> | undefined)
      : undefined;
  const officialCandidates = db
    ? (
        nearestOfficialStations(db, point) as Array<
          Record<string, unknown> & { distanceKm: number }
        >
      ).filter((station) => station.state === spot.state)
    : [];
  const lockedStationId = preference?.station_locked
    ? String(preference.official_station_id ?? "")
    : "";
  const officialStation = lockedStationId
    ? (officialCandidates.find(
        (station) => String(station.station_id) === lockedStationId,
      ) ?? null)
    : (officialCandidates.find((station) => station.distanceKm <= 300) ?? null);
  const preferredTideSource = canonicalTideSource(
    input.preferredTideSource ??
      preference?.preferred_tide_source ??
      "BOM_OFFICIAL",
  );
  const timeOffset = Number(preference?.official_station_time_offset_min ?? 0),
    heightOffset = Number(preference?.official_station_height_offset_m ?? 0);
  const official =
    officialStation && db
      ? {
          station: officialStation,
          events: officialEvents(
            db,
            String(officialStation.station_id),
            new Date(start.getTime() - 12 * 3_600_000).toISOString(),
            end.toISOString(),
            timeOffset,
            heightOffset,
          ),
          timeOffsetMinutes: timeOffset,
          heightOffsetM: heightOffset,
          stationLocked: Boolean(lockedStationId),
          candidates: officialCandidates,
          interpolationNotice:
            "根据官方10分钟预测序列提取高低潮事件；小时曲线为事件间显示插值。",
        }
      : null;
  const tasks = [
    weatherProvider.getHourly(point, 7, spot.timezone),
    marineApplicability(spot.spotType, spot.waterType) === "NOT_APPLICABLE"
      ? Promise.resolve([])
      : marineProvider.getHourly(point, 7),
    getBomWarnings(spot.state),
    getBomObservation(point, spot.state),
    getBomMarineForecast(point, spot.state),
    calculateEot20({
      ...point,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      intervalMinutes: 60,
      spotType: spot.spotType,
      waterType: spot.waterType,
      timezone: spot.timezone,
    }),
    getRainContext(point),
    getBrooklynHydrology(point),
    spot.state === "NSW"
      ? getNswMhlWaveObservation(point, spot.spotType, spot.waterType)
      : Promise.resolve(null),
  ] as const;
  const [
    weatherR,
    marineR,
    warningsR,
    observationR,
    marineForecastR,
    eot20R,
    rainR,
    waterDataR,
    mhlR,
  ] = await Promise.allSettled(tasks);
  if (weatherR.status === "rejected")
    throw new Error("WEATHER_PROVIDER_UNAVAILABLE", { cause: weatherR.reason });
  const liveWeather: Partial<HourlyEnvironment>[] = weatherR.value;
  if (!liveWeather.length) throw new Error("WEATHER_PROVIDER_EMPTY");
  const marine: Partial<HourlyEnvironment & { modelGridDistanceKm: number }>[] =
    marineR.status === "fulfilled" ? marineR.value : [];
  const warnings = warningsR.status === "fulfilled" ? warningsR.value : null,
    observation =
      observationR.status === "fulfilled" ? observationR.value : null,
    bomMarine =
      marineForecastR.status === "fulfilled" ? marineForecastR.value : null,
    eot20 = eot20R.status === "fulfilled" ? eot20R.value : null,
    mhl = mhlR.status === "fulfilled" ? mhlR.value : null;
  const warningMatch = warnings
    ? matchBomWarnings(warnings.warnings, point, spot.state)
    : null;
  const mApplicability = marineApplicability(spot.spotType, spot.waterType);
  const selectedTide =
    preferredTideSource === "EOT20_MODEL" && eot20
      ? "EOT20_MODEL"
      : preferredTideSource === "BOM_OFFICIAL" && official?.events.length
        ? "BOM_OFFICIAL"
        : "NO_TIDE";
  const tideFallbackReason =
    selectedTide === preferredTideSource
      ? null
      : preferredTideSource === "EOT20_MODEL"
        ? String(
            eot20R.status === "rejected" ? eot20R.reason : "EOT20_UNAVAILABLE",
          )
        : preferredTideSource === "BOM_OFFICIAL"
          ? lockedStationId
            ? "LOCKED_OFFICIAL_STATION_UNAVAILABLE"
            : "OFFICIAL_TIDE_UNAVAILABLE"
          : null;
  const marineForecastMaxKnots = bomMarine
    ? Math.max(
        0,
        ...[...bomMarine.text.matchAll(/(?:to|up to)\s+(\d+)\s+knots/gi)].map(
          (match) => Number(match[1]),
        ),
      )
    : 0;
  const hours: Array<
    HourlyEnvironment & { score: ReturnType<typeof scoreHour> }
  > = liveWeather.slice(0, 168).map((w, i) => {
    const timestampUtc = String(w.timestampUtc),
      m = marine[i] ?? {};
    const officialPoint = official
        ? interpolateOfficial(official.events as TideEvent[], timestampUtc)
        : null,
      modelPoint =
        eot20?.values.find(
          (value) =>
            Math.abs(
              new Date(value.timestampUtc).getTime() -
                new Date(timestampUtc).getTime(),
            ) <
            31 * 60_000,
        ) ?? null;
    const tide =
      selectedTide === "BOM_OFFICIAL"
        ? officialPoint
        : selectedTide === "EOT20_MODEL"
          ? modelPoint
          : null;
    const activeMarineWarning = warningMatch?.matches.find(
      (warning) =>
        warning.matchStatus === "AFFECTED" &&
        /marine|wind warning|hazardous surf|damaging waves|abnormally high tides/i.test(
          warning.title,
        ) &&
        warningOverlapsWindow(warning, timestampUtc, new Date(new Date(timestampUtc).getTime()+60*60_000).toISOString()),
    );
    const possiblyAffectedWarning = warningMatch?.matches.find(
      (warning) =>
        warning.matchStatus === "POSSIBLY_AFFECTED" &&
        warningOverlapsWindow(warning, timestampUtc, new Date(new Date(timestampUtc).getTime()+60*60_000).toISOString()),
    );
    const currentHours =
      (new Date(timestampUtc).getTime() - Date.now()) / 3_600_000;
    const observed =
      observation?.selected && currentHours >= -1 && currentHours <= 3
        ? observation.selected
        : null;
    const forecastWind = w.windSpeedKmh ?? null,
      observedHigher =
        observed?.windSpeedKmh !== null &&
        forecastWind !== null &&
        Number(observed?.windSpeedKmh) > forecastWind + 8;
    const windSpeed = observedHigher
      ? Number(observed?.windSpeedKmh)
      : forecastWind;
    const gust =
      observed && observed.gustKmh !== null
        ? Math.max(w.windGustKmh ?? 0, observed.gustKmh)
        : (w.windGustKmh ?? null);
    const marineConflict =
      marineForecastMaxKnots * 1.852 > (forecastWind ?? 0) + 15;
    const mhlCurrent =
      mhl?.applicability === "APPLICABLE" && currentHours >= -1 && currentHours <= 3
        ? mhl
        : null;
    let overall = 0.96;
    if (warningsR.status === "rejected") overall -= 0.28;
    if (observationR.status === "rejected") overall -= 0.08;
    if (mApplicability === "LOW_CONFIDENCE") overall -= 0.12;
    if (marineR.status === "rejected") overall -= 0.1;
    if (selectedTide === "NO_TIDE") overall -= 0.12;
    if (
      selectedTide === "EOT20_MODEL" &&
      eot20?.applicability === "LOW_CONFIDENCE"
    )
      overall -= 0.16;
    if (official && official.station.distanceKm > 100) overall -= 0.1;
    if (observedHigher) overall -= 0.12;
    if (marineConflict) overall -= 0.12;
    if (mhlR.status === "rejected" && spot.state === "NSW") overall -= 0.03;
    const env: HourlyEnvironment = {
      timestampUtc,
      timestampLocal: String(w.timestampLocal),
      timezone: spot.timezone,
      temperatureC: w.temperatureC ?? null,
      apparentTemperatureC: w.apparentTemperatureC ?? null,
      humidityPercent: w.humidityPercent ?? null,
      precipitationProbabilityPercent:
        w.precipitationProbabilityPercent ?? null,
      precipitationMm: w.precipitationMm ?? null,
      windSpeedKmh: windSpeed,
      windGustKmh: gust,
      windDirectionDeg: w.windDirectionDeg ?? null,
      pressureHpa: w.pressureHpa ?? null,
      pressureTrendHpa3h:
        i >= 3 &&
        w.pressureHpa !== null &&
        liveWeather[i - 3]?.pressureHpa !== null
          ? Number(
              (
                (w.pressureHpa ?? 0) - (liveWeather[i - 3]?.pressureHpa ?? 0)
              ).toFixed(1),
            )
          : null,
      cloudCoverPercent: w.cloudCoverPercent ?? null,
      waveHeightM:
        mApplicability !== "NOT_APPLICABLE" &&
        mApplicability !== "LOW_CONFIDENCE"
          ? Math.max(m.waveHeightM ?? 0, mhlCurrent?.significantWaveHeightM ?? 0) || null
          : null,
      swellHeightM:
        mApplicability === "APPLICABLE" ? (m.swellHeightM ?? null) : null,
      swellPeriodSeconds:
        mApplicability === "APPLICABLE" ? (m.swellPeriodSeconds ?? null) : null,
      modelSeaLevelTrendM: m.modelSeaLevelTrendM ?? null,
      tideHeightM: tide?.heightM ?? null,
      tidePhase: tide?.phase ?? null,
      warningSeverity:
        activeMarineWarning?.severity ??
        (possiblyAffectedWarning ? "moderate" : warnings ? "none" : "unknown"),
      daylightState: w.daylightState ?? "night",
      sources: {
        ...(w.sources ?? {}),
        ...(m.sources ?? {}),
        ...(selectedTide === "BOM_OFFICIAL"
          ? {
              tide: `${String(officialStation?.provider ?? "Official")} station prediction`,
            }
          : selectedTide === "EOT20_MODEL"
            ? { tide: "EOT20 global model" }
            : {}),
        ...(observed ? { observation: `BOM ${observed.stationName}` } : {}),
        ...(mhlCurrent
          ? { waveObservation: `NSW MHL ${mhlCurrent.stationName} (offshore)` }
          : {}),
      },
      fetchedAtUtc: new Date().toISOString(),
      dataQuality: {
        weather: 0.96,
        marine:
          mApplicability === "NOT_APPLICABLE"
            ? 1
            : mApplicability === "LOW_CONFIDENCE"
              ? 0.45
              : marine.length
                ? 0.8
                : 0,
        tide:
          selectedTide === "BOM_OFFICIAL"
            ? 0.9
            : selectedTide === "EOT20_MODEL"
              ? (eot20?.confidence ?? 0)
              : 0,
        warnings: warnings ? 1 : 0,
        observations: observation?.selected ? 0.8 : 0,
        overall: Math.max(0.1, overall),
      },
    };
    return { ...env, score: scoreHour(env, spot.spotType) };
  });
  const grouped = new Map<string, typeof hours>();
  for (const hour of hours) {
    const date = hour.timestampLocal.slice(0, 10);
    const existing = grouped.get(date);
    if (existing) existing.push(hour);
    else grouped.set(date, [hour]);
  }
  const days = [...grouped.entries()].slice(0, 7).map(([date, slice]) => ({
    date,
    hours: slice,
    windows: mergeWindows(
      slice.map((hour) => ({
        timestampUtc: hour.timestampUtc,
        score: hour.score,
      })),
    ).slice(0, 2),
  }));
  const officialNextHigh = official?.events.find(
      (event) => event.type === "HIGH" && new Date(event.timeUtc) > start,
    ),
    officialNextLow = official?.events.find(
      (event) => event.type === "LOW" && new Date(event.timeUtc) > start,
    ),
    modelNextHigh = eot20?.events.find(
      (event) => event.type === "HIGH" && new Date(event.timestampUtc) > start,
    ),
    modelNextLow = eot20?.events.find(
      (event) => event.type === "LOW" && new Date(event.timestampUtc) > start,
    );
  const initialForecastWind=liveWeather[0]?.windSpeedKmh ?? null;
  const forecastVsObservation = observation?.selected ? {
    forecastWindKmh: initialForecastWind,
    observedWindKmh: observation.selected.windSpeedKmh,
    observedGustKmh: observation.selected.gustKmh,
    windDifferenceKmh: initialForecastWind !== null && observation.selected.windSpeedKmh !== null ? Number((observation.selected.windSpeedKmh-initialForecastWind).toFixed(1)) : null,
    affectsSafety: Boolean(hours[0]?.score.safetyStatus !== 'SAFE'),
    affectsComfort: Boolean(hours[0]?.score.comfortScore < 70),
  } : null;
  return {
    spot,
    days,
    astronomy: localAstronomy(point),
    rainfallContext:
      rainR.status === "fulfilled"
        ? rainR.value
        : { status: "UNAVAILABLE", reason: String(rainR.reason) },
    waterData:
      waterDataR.status === "fulfilled"
        ? waterDataR.value
        : {
            status: "BLOCKED_BY_PROVIDER_LIMITATION",
            detail: String(waterDataR.reason),
          },
    tides: {
      selectedSource: selectedTide,
      preferredSource: preferredTideSource,
      actualTideSourceUsed: selectedTide,
      fallbackReason: tideFallbackReason,
      selectedTideSource: preferredTideSource,
      officialStationId: officialStation?.station_id ?? null,
      officialStationDistanceKm: officialStation?.distanceKm ?? null,
      officialTimeOffsetMinutes: timeOffset,
      officialHeightOffsetM: heightOffset,
      eot20ModelVersion: eot20?.version ?? eot20Status().version,
      eot20Applicability:
        eot20?.applicability ??
        eot20Applicability(spot.spotType, spot.waterType),
      tideRuleVersion: RULE_VERSION,
      official,
      model: eot20 ?? {
        ...eot20Status(),
        status: "UNAVAILABLE",
        applicability: eot20Applicability(spot.spotType, spot.waterType),
      },
      comparison:
        officialNextHigh && modelNextHigh
          ? {
              officialHigh: officialNextHigh,
              modelHigh: modelNextHigh,
              timeDifferenceMinutes: Math.round(
                Math.abs(
                  new Date(officialNextHigh.timeUtc).getTime() -
                    new Date(modelNextHigh.timestampUtc).getTime(),
                ) / 60_000,
              ),
              heightDifferenceM: Number(
                Math.abs(
                  officialNextHigh.heightM - modelNextHigh.heightM,
                ).toFixed(2),
              ),
              officialLow: officialNextLow ?? null,
              modelLow: modelNextLow ?? null,
              lowTimeDifferenceMinutes:
                officialNextLow && modelNextLow
                  ? Math.round(
                      Math.abs(
                        new Date(officialNextLow.timeUtc).getTime() -
                          new Date(modelNextLow.timestampUtc).getTime(),
                      ) / 60_000,
                    )
                  : null,
              officialConfidence:
                Number(officialStation?.distanceKm) > 100 ? 0.7 : 0.9,
              modelConfidence: eot20?.confidence ?? 0,
              actualTideSourceUsed: selectedTide,
            }
          : null,
    },
    warnings: warnings
      ? {
          ...warnings,
          status: warningMatch?.status ?? "UNKNOWN",
          warnings: warningMatch?.matches ?? warnings.warnings,
          matchStatus: warningMatch?.status ?? "UNKNOWN",
          checkedAtUtc: warnings.fetchedAtUtc,
        }
      : {
          status: "UNAVAILABLE",
          matchStatus: "UNKNOWN",
          reason: String(
            warningsR.status === "rejected" ? warningsR.reason : "NO_DATA",
          ),
        },
    observation: observation ? { ...observation, forecastVsObservation } : {
      status: "UNAVAILABLE",
      reason: String(
        observationR.status === "rejected" ? observationR.reason : "NO_DATA",
      ),
    },
    bomMarineForecast: bomMarine ?? {
      status: "UNAVAILABLE",
      reason: String(
        marineForecastR.status === "rejected"
          ? marineForecastR.reason
          : "NO_DATA",
      ),
    },
    nswMhlWave: mhl ?? {
      status: spot.state === "NSW" ? "UNAVAILABLE" : "NOT_APPLICABLE",
      reason:
        spot.state === "NSW"
          ? String(mhlR.status === "rejected" ? mhlR.reason : "NO_DATA")
          : "NSW_PROVIDER_ONLY",
    },
    marineApplicability: {
      status: mApplicability,
      requestedCoordinates: point,
      returnedCoordinates: marine[0]
        ? {
            latitude: Number(
              (marine[0] as Record<string, unknown>).modelReturnedLatitude,
            ),
            longitude: Number(
              (marine[0] as Record<string, unknown>).modelReturnedLongitude,
            ),
          }
        : null,
      gridDistanceKm: marine[0]
        ? Number((marine[0] as Record<string, unknown>).modelGridDistanceKm)
        : null,
      spotType: spot.spotType,
      waterType: spot.waterType,
      reason:
        mApplicability === "LOW_CONFIDENCE"
          ? "港湾、河口或河流内部的外海网格不能等同现场浪况"
          : mApplicability === "NOT_APPLICABLE"
            ? "淡水钓点不使用 Marine 数据"
            : null,
    },
    providerStatus: {
      weather: { status: "available", provider: "Open-Meteo" },
      marine: {
        status: marine.length
          ? "available"
          : mApplicability === "NOT_APPLICABLE"
            ? "not_applicable"
            : "unavailable",
        provider: "Open-Meteo Marine",
      },
      officialTide: {
        status: official?.events.length ? "available" : "unavailable",
        provider: "BOM/MSQ official station",
        reason: official ? "NO_EVENTS" : "NO_NEARBY_IMPORTED_STATION",
      },
      eot20: {
        status: eot20 ? "available" : "unavailable",
        provider: "EOT20",
        reason: eot20 ? null : eot20Status().reason,
      },
      warnings: {
        status: warnings ? "available" : "unavailable",
        provider: "BOM RSS",
      },
      observations: {
        status: observation?.selected ? "available" : "unavailable",
        provider: "BOM 10-minute observations",
      },
      bomMarine: {
        status: bomMarine ? "available" : "unavailable",
        provider: "BOM text forecast",
      },
      nswMhlWave: {
        status: mhl ? "available" : spot.state === "NSW" ? "unavailable" : "not_applicable",
        provider: "NSW MHL offshore wave buoy",
      },
    },
    degraded: [marineR, warningsR, observationR, marineForecastR, eot20R, mhlR].some(
      (result) => result.status === "rejected",
    ),
    generatedAtUtc: new Date().toISOString(),
  };
}
type TideEvent = { type: "HIGH" | "LOW"; timeUtc: string; heightM: number };
function interpolateOfficial(events: TideEvent[], timestampUtc: string) {
  const time = new Date(timestampUtc).getTime();
  const nextIndex = events.findIndex(
    (event) => new Date(event.timeUtc).getTime() >= time,
  );
  if (nextIndex <= 0) return null;
  const previous = events[nextIndex - 1],
    next = events[nextIndex],
    start = new Date(previous.timeUtc).getTime(),
    finish = new Date(next.timeUtc).getTime(),
    ratio = (time - start) / (finish - start),
    heightM = previous.heightM + (next.heightM - previous.heightM) * ratio;
  return {
    heightM: Number(heightM.toFixed(3)),
    phase:
      Math.abs(next.heightM - previous.heightM) < 0.01
        ? ("slack" as const)
        : next.heightM > previous.heightM
          ? ("rising" as const)
          : ("falling" as const),
  };
}
