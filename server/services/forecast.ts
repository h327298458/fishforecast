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
import { scoreHour, mergeWindows, RULE_VERSION, type SpotSafetyProfile } from "../domain/scoring.js";
import type { HourlyEnvironment } from "../domain/types.js";
import {
  getRainContext,
  localAstronomy,
} from "../providers/environmentContext.js";
import { getNswMhlWaveObservation } from "../providers/nswMhlWave.js";
import { getBrooklynHydrology } from "../providers/brooklynHydrology.js";
import { getRegulationEntry } from "../providers/regulations.js";
import {
  resolveActualTideSource,
  shouldCalculateEot20ForForecast,
  type CanonicalTideSource,
} from "./tideSelection.js";
import { compareTideSources } from "../../src/domain/tideComparison.js";

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
  deferEot20: false,
  reassessOnly: false,
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
const withProviderTimeout = <T>(promise: Promise<T>, provider: string, milliseconds = 6_000) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${provider}_TIMEOUT`)), milliseconds);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

export async function buildForecast(input: Input = {}, db?: Database.Database) {
  const spot = { ...baseSpot, ...input };
  const point = { latitude: spot.latitude, longitude: spot.longitude };
  // EOT20 cache keys contain the requested range. Aligning forecast ranges to
  // the UTC hour makes repeat requests within that hour reuse the same result.
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86_400_000);
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
  const optionalNumber = (value: unknown) => value === null || value === undefined || value === "" ? null : Number(value);
  const safetyProfile: SpotSafetyProfile = {
    exposureDirectionDeg: optionalNumber(preference?.exposure_direction_deg),
    maximumWindKmh: optionalNumber(preference?.maximum_wind_kmh),
    maximumGustKmh: optionalNumber(preference?.maximum_gust_kmh),
    maximumWaveHeightM: optionalNumber(preference?.maximum_wave_height_m),
    openCoast: Boolean(preference?.open_coast),
    rockAccessRequired: Boolean(preference?.rock_access_required),
    sheltered: Boolean(preference?.has_building_shelter) || Boolean(preference?.has_cliff_shelter),
  };
  const officialEventRows = officialStation && db
    ? officialEvents(
        db,
        String(officialStation.station_id),
        new Date(start.getTime() - 12 * 3_600_000).toISOString(),
        end.toISOString(),
        timeOffset,
        heightOffset,
      )
    : [];
  const official =
    officialStation && db
      ? {
          station: officialStation,
          events: officialEventRows,
          dataYears: [...new Set(officialEventRows.map((event) => Number(event.sourceYear)))].sort(),
          timeOffsetMinutes: timeOffset,
          heightOffsetM: heightOffset,
          stationLocked: Boolean(lockedStationId),
          candidates: officialCandidates,
          interpolationNotice:
            "根据官方10分钟预测序列提取高低潮事件；小时曲线为事件间显示插值。",
        }
      : null;
  const eot20Installation = eot20Status();
  const eot20WaterApplicability = eot20Applicability(
    spot.spotType,
    spot.waterType,
  );
  const shouldCalculateEot20 = shouldCalculateEot20ForForecast({
    preferredSource: preferredTideSource as CanonicalTideSource,
    officialAvailable: Boolean(official?.events.length),
    officialStationLocked: Boolean(lockedStationId),
    modelInstalled: eot20Installation.status === "REAL",
    modelApplicable: eot20WaterApplicability !== "NOT_APPLICABLE",
  });
  // Keep the current-day curve complete. The numerical model starts 24 hours
  // before the weather range so midnight values are available even when the
  // first request is made late in the day. These are model values, not a flat
  // extrapolation of the first current-time value.
  const eot20Start = new Date(start.getTime() - 24 * 3_600_000);
  const tideCalculationPending = Boolean(
    spot.deferEot20 && shouldCalculateEot20,
  );
  const eot20Task =
    shouldCalculateEot20 && !tideCalculationPending
      ? calculateEot20({
          ...point,
          startUtc: eot20Start.toISOString(),
          endUtc: end.toISOString(),
          intervalMinutes: 60,
          spotType: spot.spotType,
          waterType: spot.waterType,
          timezone: spot.timezone,
        })
      : Promise.resolve(null);
  const tasks = [
    withProviderTimeout(weatherProvider.getHourly(point, 7, spot.timezone), "WEATHER", 12_000),
    marineApplicability(spot.spotType, spot.waterType) === "NOT_APPLICABLE"
      ? Promise.resolve([])
      : withProviderTimeout(marineProvider.getHourly(point, 7), "MARINE"),
    withProviderTimeout(getBomWarnings(spot.state), "BOM_WARNINGS"),
    withProviderTimeout(getBomObservation(point, spot.state), "BOM_OBSERVATION"),
    withProviderTimeout(getBomMarineForecast(point, spot.state), "BOM_MARINE"),
    eot20Task,
    withProviderTimeout(getRainContext(point), "RAIN_CONTEXT"),
    withProviderTimeout(getBrooklynHydrology(point), "WATER_DATA"),
    spot.state === "NSW"
      ? withProviderTimeout(getNswMhlWaveObservation(point, spot.spotType, spot.waterType), "NSW_MHL")
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
  const selectedTide = resolveActualTideSource({
    preferredSource: preferredTideSource as CanonicalTideSource,
    officialAvailable: Boolean(official?.events.length),
    officialStationLocked: Boolean(lockedStationId),
    modelAvailable: Boolean(eot20),
  });
  const tideFallbackReason =
    tideCalculationPending
      ? preferredTideSource === "EOT20_MODEL"
        ? "EOT20_CALCULATION_PENDING"
        : "OFFICIAL_TIDE_UNAVAILABLE_EOT20_PENDING"
      : selectedTide === preferredTideSource
      ? null
      : preferredTideSource === "EOT20_MODEL"
        ? String(
            eot20R.status === "rejected" ? eot20R.reason : "EOT20_UNAVAILABLE",
          )
        : preferredTideSource === "BOM_OFFICIAL"
          ? selectedTide === "EOT20_MODEL"
            ? "OFFICIAL_TIDE_UNAVAILABLE_AUTO_EOT20"
            : lockedStationId
              ? "LOCKED_OFFICIAL_STATION_UNAVAILABLE"
              : shouldCalculateEot20
                ? "OFFICIAL_TIDE_UNAVAILABLE_AND_EOT20_FALLBACK_FAILED"
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
  const eot20FailureReason =
    eot20R.status === "rejected"
      ? String(eot20R.reason instanceof Error ? eot20R.reason.message : eot20R.reason)
      : null;
  const selectedTideEvents = (selectedTide === "BOM_OFFICIAL"
      ? (official?.events ?? []).map((event) => ({ type: event.type as "HIGH"|"LOW", timestampUtc: event.timeUtc }))
      : selectedTide === "EOT20_MODEL"
        ? (eot20?.events ?? []).map((event) => ({ type: event.type as "HIGH"|"LOW", timestampUtc: event.timestampUtc }))
        : [])
    .map((event) => ({ ...event, time: new Date(event.timestampUtc).getTime() }))
    .filter((event) => Number.isFinite(event.time))
    .sort((a, b) => a.time - b.time);
  const selectedTidePoint = (timestampUtc: string) =>
    selectedTide === "BOM_OFFICIAL"
      ? official
        ? interpolateOfficial(official.events as TideEvent[], timestampUtc)
        : null
      : selectedTide === "EOT20_MODEL"
        ? eot20
          ? interpolateEot20(eot20.values, timestampUtc)
          : null
        : null;
  const selectedTideContext = (timestampUtc: string) => {
    const time = new Date(timestampUtc).getTime();
    if (!Number.isFinite(time)) return null;
    const current = selectedTidePoint(timestampUtc);
    if (!current) return null;
    const before = selectedTidePoint(new Date(time - 3_600_000).toISOString());
    const after = selectedTidePoint(new Date(time + 3_600_000).toISOString());
    const rate = before && after
      ? (after.heightM - before.heightM) / 2
      : after
        ? after.heightM - current.heightM
        : before
          ? current.heightM - before.heightM
          : null;
    const nearest = selectedTideEvents.reduce<(typeof selectedTideEvents)[number] | null>(
      (best, event) => !best || Math.abs(event.time - time) < Math.abs(best.time - time) ? event : best,
      null,
    );
    const next = selectedTideEvents.find((event) => event.time >= time) ?? null;
    return {
      point: current,
      changeRateMPerHour: rate === null ? null : Number(rate.toFixed(3)),
      phase: rate === null ? current.phase : Math.abs(rate) < 0.01 ? "slack" as const : rate > 0 ? "rising" as const : "falling" as const,
      minutesToNearestEvent: nearest ? Math.round(Math.abs(nearest.time - time) / 60_000) : null,
      nearestEventType: nearest?.type ?? null,
      minutesToNextEvent: next ? Math.round((next.time - time) / 60_000) : null,
      nextEventType: next?.type ?? null,
    };
  };
  const hours: Array<
    HourlyEnvironment & { score: ReturnType<typeof scoreHour> }
  > = liveWeather.slice(0, 168).map((w, i) => {
    const timestampUtc = String(w.timestampUtc),
      m = marine[i] ?? {};
    const officialPoint = official
        ? interpolateOfficial(official.events as TideEvent[], timestampUtc)
        : null,
      modelPoint = eot20
        ? interpolateEot20(eot20.values, timestampUtc)
        : null;
    const tide = selectedTide === "BOM_OFFICIAL" ? officialPoint : selectedTide === "EOT20_MODEL" ? modelPoint : null;
    const tideContext = tide ? selectedTideContext(timestampUtc) : null;
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
    // BOM's zone forecast is textual and not hourly.  It is an additional
    // safety opinion for the near term only; applying it to every hour of a
    // seven-day numerical forecast made confidence incorrectly flat.
    const marineConflict =
      currentHours <= 24 &&
      forecastWind !== null &&
      marineForecastMaxKnots * 1.852 > forecastWind + 15;
    const mhlCurrent =
      mhl?.applicability === "APPLICABLE" && currentHours >= -1 && currentHours <= 3
        ? mhl
        : null;
    const waveHeightM =
      mApplicability === "APPLICABLE"
        ? Math.max(m.waveHeightM ?? 0, mhlCurrent?.significantWaveHeightM ?? 0) || null
        : null;
    const waveDataStatus =
      mApplicability === "NOT_APPLICABLE"
        ? "NOT_APPLICABLE"
        : mApplicability === "LOW_CONFIDENCE"
          ? "LOW_CONFIDENCE"
          : marineR.status === "rejected" || waveHeightM === null
            ? "UNAVAILABLE"
            : "AVAILABLE";
    const confidenceReasons: string[] = [];
    let overall = 0.94;
    const leadHours = Math.max(0, currentHours);
    const leadPenalty = Math.min(0.2, (leadHours / (7 * 24)) * 0.2);
    overall -= leadPenalty;
    confidenceReasons.push(
      leadHours < 1
        ? "预报接近当前时间"
        : `预报距当前约 ${Math.round(leadHours)} 小时`,
    );
    if (warningsR.status === "rejected") {
      overall -= 0.28;
      confidenceReasons.push("BOM 官方警告本次无法获取，安全状态按未知处理");
    } else confidenceReasons.push("BOM 官方警告已完成本次检查");
    if (observationR.status === "rejected" && currentHours <= 3) {
      overall -= 0.08;
      confidenceReasons.push("近期 BOM 实况无法获取");
    } else if (observed) confidenceReasons.push("近期窗口已参考 BOM 实况");
    if (mApplicability === "LOW_CONFIDENCE") {
      overall -= 0.12;
      confidenceReasons.push("该钓点为港湾、河口或内河，外海 Marine 网格仅低可信度参考");
    }
    if (marineR.status === "rejected") {
      overall -= 0.1;
      confidenceReasons.push("Marine 波浪数据本次无法获取");
    }
    if (selectedTide === "NO_TIDE") {
      if (tideCalculationPending) {
        overall -= 0.04;
        confidenceReasons.push("EOT20 正在后台计算，当前评分暂未计入潮汐");
      } else {
        overall -= 0.16;
        confidenceReasons.push("本时段没有可用的正式潮汐评分数据");
      }
    } else if (selectedTide === "BOM_OFFICIAL") {
      confidenceReasons.push("使用官方参考港潮汐；并非钓点现场逐分钟潮位");
    } else confidenceReasons.push("使用 EOT20 经纬度模型潮汐");
    if (
      selectedTide === "EOT20_MODEL" &&
      eot20?.applicability === "LOW_CONFIDENCE"
    ) {
      overall -= 0.16;
      confidenceReasons.push("EOT20 在此类水域仅低可信度参考");
    }
    if (official && official.station.distanceKm > 100) {
      overall -= 0.1;
      confidenceReasons.push(`官方参考港距离 ${Number(official.station.distanceKm).toFixed(0)} km，代表性降低`);
    }
    if (observedHigher) {
      overall -= 0.12;
      confidenceReasons.push("BOM 实测风速明显高于数值预报");
    }
    if (marineConflict) {
      overall -= 0.04;
      confidenceReasons.push("BOM 海域文字预报风力较数值预报更强，按保守原则处理");
    }
    if (mhlR.status === "rejected" && spot.state === "NSW" && currentHours <= 3) {
      overall -= 0.03;
      confidenceReasons.push("NSW MHL 浮标实况本次无法获取");
    }
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
      waveHeightM,
      waveDataStatus,
      swellHeightM:
        mApplicability === "APPLICABLE" ? (m.swellHeightM ?? null) : null,
      swellPeriodSeconds:
        mApplicability === "APPLICABLE" ? (m.swellPeriodSeconds ?? null) : null,
      modelSeaLevelTrendM: m.modelSeaLevelTrendM ?? null,
      tideHeightM: tide?.heightM ?? null,
      tidePhase: tideContext?.phase ?? tide?.phase ?? null,
      tideChangeRateMPerHour: tideContext?.changeRateMPerHour ?? null,
      minutesToNearestTideEvent: tideContext?.minutesToNearestEvent ?? null,
      nearestTideEventType: tideContext?.nearestEventType ?? null,
      minutesToNextTideEvent: tideContext?.minutesToNextEvent ?? null,
      nextTideEventType: tideContext?.nextEventType ?? null,
      tideDataStatus: tideCalculationPending
        ? "PENDING"
        : tide
          ? "AVAILABLE"
          : "UNAVAILABLE",
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
        reasons: confidenceReasons,
      },
    };
    return { ...env, score: scoreHour(env, spot.spotType, safetyProfile, spot.fishingMethod) };
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
      slice
        .filter(
          (hour) => new Date(hour.timestampUtc).getTime() >= start.getTime(),
        )
        .map((hour) => ({
          timestampUtc: hour.timestampUtc,
          score: hour.score,
        })),
    ),
  }));
  const tideComparison = official && eot20
    ? compareTideSources({
        officialEvents: official.events.map((event) => ({
          type: event.type as "HIGH" | "LOW",
          timeUtc: event.timeUtc,
          heightM: event.heightM,
        })),
        modelEvents: eot20.events,
        referenceTimeUtc: start.toISOString(),
        officialDatum: String(official.station.datum ?? "Lowest Astronomical Tide (LAT)"),
        modelDatum: "Mean Sea Level (MSL)",
        officialConfidence: Number(officialStation?.distanceKm) > 100 ? 0.7 : 0.9,
        modelConfidence: eot20.confidence,
        actualTideSourceUsed: selectedTide,
      })
    : null;
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
    evaluation: {
      mode: spot.reassessOnly ? "REASSESSMENT" : "FULL",
      environmentCoordinatesFixed: true,
      detail: spot.reassessOnly
        ? "优先复用同一坐标和时段的Provider缓存，重新评估钓点类型、钓法、适用性与评分；新类型若需要此前未请求的数据则补取"
        : "读取坐标对应环境数据并生成评分",
    },
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
    regulations: getRegulationEntry(spot.state),
    tides: {
      calculationStatus: tideCalculationPending ? "PENDING" : "COMPLETE",
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
      model: eot20 ?? (() => {
        const installation = eot20Installation;
        const installed = installation.status === "REAL";
        return {
        ...installation,
        available: installed,
        status:
          tideCalculationPending
            ? "PENDING"
            : shouldCalculateEot20 || !installed
              ? "UNAVAILABLE"
              : "NOT_REQUESTED",
        calculated: false,
        request: tideCalculationPending
          ? {
              startUtc: eot20Start.toISOString(),
              endUtc: end.toISOString(),
              intervalMinutes: 60,
            }
          : null,
        reason:
          tideCalculationPending
            ? "EOT20_BACKGROUND_CALCULATION_REQUIRED"
            : shouldCalculateEot20
            ? (eot20FailureReason ?? "EOT20_UNAVAILABLE")
            : installed
              ? "ON_DEMAND_MODEL_NOT_REQUESTED"
              : installation.reason,
        applicability: eot20Applicability(spot.spotType, spot.waterType),
        };
      })(),
      comparison: tideComparison,
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
        status: official?.events.length
          ? "available"
          : official
            ? "no_data"
            : "unavailable",
        provider: "BOM/MSQ official station",
        reason: official?.events.length
          ? null
          : official
            ? "NO_EVENTS_IN_QUERY_RANGE"
            : "NO_NEARBY_IMPORTED_STATION",
      },
      eot20: {
        status: eot20
          ? "available"
          : tideCalculationPending
            ? "pending"
          : shouldCalculateEot20
            ? "unavailable"
            : eot20Installation.status === "REAL"
              ? "not_requested"
              : "unavailable",
        provider: "EOT20",
        reason: eot20
          ? null
          : tideCalculationPending
            ? "EOT20_BACKGROUND_CALCULATION_REQUIRED"
          : shouldCalculateEot20
            ? (eot20FailureReason ?? eot20Installation.reason ?? "EOT20_UNAVAILABLE")
            : eot20Installation.status === "REAL"
              ? "ON_DEMAND_MODEL_NOT_REQUESTED"
              : (eot20Installation.reason ?? "EOT20_UNAVAILABLE"),
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

export function interpolateEot20(
  values: Array<{
    timestampUtc: string;
    heightM: number;
    phase: "rising" | "falling" | "slack";
  }>,
  timestampUtc: string,
) {
  const time = new Date(timestampUtc).getTime();
  const nextIndex = values.findIndex(
    (value) => new Date(value.timestampUtc).getTime() >= time,
  );
  if (nextIndex === -1) return null;
  const next = values[nextIndex];
  const nextTime = new Date(next.timestampUtc).getTime();
  // Never extend the first model value backwards. That rendered a fake flat
  // line from local midnight until the model request's current-hour start.
  if (nextIndex === 0 && nextTime !== time) return null;
  if (nextTime === time) {
    return { heightM: next.heightM, phase: next.phase };
  }
  const previous = values[nextIndex - 1];
  const start = new Date(previous.timestampUtc).getTime();
  const finish = new Date(next.timestampUtc).getTime();
  if (finish <= start || time < start) return null;
  const ratio = (time - start) / (finish - start);
  return {
    heightM: Number((previous.heightM + (next.heightM - previous.heightM) * ratio).toFixed(3)),
    phase:
      Math.abs(next.heightM - previous.heightM) < 0.01
        ? ("slack" as const)
        : next.heightM > previous.heightM
          ? ("rising" as const)
          : ("falling" as const),
  };
}
