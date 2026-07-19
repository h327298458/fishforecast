import type { HourlyEnvironment, ScoreResult, SafetyStatus } from "./types.js";

export const RULE_VERSION = "2026.07-context-method.6";
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
export const angularDifference = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
export const weightedScore = (items: Array<{ value: number | null; weight: number }>) => {
  const usable = items.filter((item): item is { value: number; weight: number } => item.value !== null);
  const weight = usable.reduce((sum, item) => sum + item.weight, 0);
  return weight ? usable.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0;
};
const inverseLinear = (value: number | null, ideal: number, bad: number) => value === null ? null : clamp(100 - Math.max(0, value - ideal) * (100 / Math.max(bad - ideal, 1)));

export function scoreMethodSuitability(env: HourlyEnvironment, evaluatedWind: number | null, evaluatedGust: number | null, fishingMethod = "bottom_fishing", spotType = "wharf") {
  const daylight = env.daylightState === "day" ? 78 : 64;
  const spotLabels: Record<string,string> = { wharf: "码头", rock: "岩岸", beach: "沙滩", estuary: "河口", freshwater: "淡水" };
  const compatibility: Record<string,Record<string,number>> = {
    bottom_fishing: { wharf: 88, rock: 76, beach: 80, estuary: 88, freshwater: 84 },
    lure: { wharf: 78, rock: 84, beach: 76, estuary: 90, freshwater: 90 },
    float: { wharf: 90, rock: 62, beach: 54, estuary: 92, freshwater: 88 },
    surf_casting: { wharf: 34, rock: 46, beach: 94, estuary: 44, freshwater: 20 },
  };
  const spotCompatibility = (compatibility[fishingMethod] ?? compatibility.bottom_fishing)[spotType] ?? 70;
  const configurations: Record<string,{label:string;usesWave:boolean;items:Array<{value:number|null;weight:number}>}> = {
    bottom_fishing: { label: "沉底钓", usesWave: true, items: [
      { value: inverseLinear(evaluatedWind, 14, 42), weight: .32 },
      { value: inverseLinear(evaluatedGust, 24, 55), weight: .23 },
      { value: inverseLinear(env.waveHeightM, 1.2, 3), weight: .2 },
      { value: spotCompatibility, weight: .25 },
    ] },
    lure: { label: "路亚", usesWave: false, items: [
      { value: inverseLinear(evaluatedWind, 10, 32), weight: .35 },
      { value: inverseLinear(evaluatedGust, 18, 45), weight: .22 },
      { value: daylight, weight: .18 },
      { value: spotCompatibility, weight: .25 },
    ] },
    float: { label: "浮漂钓", usesWave: true, items: [
      { value: inverseLinear(evaluatedWind, 8, 26), weight: .32 },
      { value: inverseLinear(evaluatedGust, 14, 36), weight: .2 },
      { value: inverseLinear(env.waveHeightM, .6, 1.8), weight: .23 },
      { value: spotCompatibility, weight: .25 },
    ] },
    surf_casting: { label: "沙滩远投", usesWave: true, items: [
      { value: inverseLinear(evaluatedWind, 18, 45), weight: .3 },
      { value: inverseLinear(evaluatedGust, 28, 60), weight: .2 },
      { value: inverseLinear(env.waveHeightM, 1.3, 3), weight: .25 },
      { value: spotCompatibility, weight: .25 },
    ] },
  };
  const configuration = configurations[fishingMethod] ?? configurations.bottom_fishing;
  const waveEvidenceMissing = configuration.usesWave && env.waveHeightM === null;
  const score = Math.min(waveEvidenceMissing ? 85 : 100, clamp(weightedScore(configuration.items)));
  const adjustment = Math.max(-6, Math.min(4, Math.round((score - 70) / 7)));
  const conditionLabel = waveEvidenceMissing ? "当前可用风况" : "当前风浪条件";
  const caveat = waveEvidenceMissing ? "；缺少适用于该水域的浪况，适配分已限制上限" : "";
  const reason = adjustment >= 2
    ? `${configuration.label}在${spotLabels[spotType] ?? spotType}与${conditionLabel}较匹配${caveat}`
    : adjustment <= -2
      ? `${configuration.label}在${spotLabels[spotType] ?? spotType}受${conditionLabel}限制${caveat}`
      : `${configuration.label}在${spotLabels[spotType] ?? spotType}的当前适用性一般${caveat}`;
  return { score, adjustment, reason, label: configuration.label };
}

export function scoreTideCondition(env: HourlyEnvironment) {
  if (env.tidePhase === null) return null;
  const phaseScore = env.tidePhase === "rising" ? 82 : env.tidePhase === "falling" ? 72 : 55;
  const rate = env.tideChangeRateMPerHour;
  const movementScore = rate === null || rate === undefined
    ? null
    : clamp(50 + Math.min(Math.abs(rate), 0.5) * 90);
  const minutes = env.minutesToNearestTideEvent;
  const timingScore = minutes === null || minutes === undefined
    ? null
    : minutes <= 30
      ? 52
      : minutes <= 120
        ? 78
        : minutes <= 240
          ? 68
          : 60;
  const score = clamp(weightedScore([
    { value: phaseScore, weight: 0.55 },
    { value: movementScore, weight: 0.25 },
    { value: timingScore, weight: 0.2 },
  ]));
  const phaseLabel = env.tidePhase === "rising" ? "涨潮" : env.tidePhase === "falling" ? "退潮" : "转潮附近";
  const movementLabel = rate === null || rate === undefined ? "变化速度未知" : `变化 ${Math.abs(rate).toFixed(2)} m/h`;
  const timingLabel = minutes === null || minutes === undefined ? "高低潮时间未知" : `距最近高低潮约 ${Math.round(minutes)} 分钟`;
  return { score, reason: `${phaseLabel}；${movementLabel}；${timingLabel}` };
}

export type SpotSafetyProfile = {
  exposureDirectionDeg?: number | null;
  maximumWindKmh?: number | null;
  maximumGustKmh?: number | null;
  maximumWaveHeightM?: number | null;
  openCoast?: boolean;
  rockAccessRequired?: boolean;
  sheltered?: boolean;
};

export function scoreHour(env: HourlyEnvironment, spotType = "wharf", profile: SpotSafetyProfile = {}, fishingMethod = "bottom_fishing"): ScoreResult {
  const waveIsDeliberatelyExcluded = env.waveDataStatus === "LOW_CONFIDENCE" || env.waveDataStatus === "NOT_APPLICABLE";
  const tideIsPending = env.tideDataStatus === "PENDING";
  const missing = Object.entries({ wind: env.windSpeedKmh, gust: env.windGustKmh, pressure: env.pressureHpa, tide: tideIsPending ? 0 : env.tideHeightM, wave: waveIsDeliberatelyExcluded ? 0 : env.waveHeightM }).filter(([, value]) => value === null).map(([key]) => key);
  const angle = profile.exposureDirectionDeg !== null && profile.exposureDirectionDeg !== undefined && env.windDirectionDeg !== null ? angularDifference(env.windDirectionDeg, profile.exposureDirectionDeg) : null;
  const exposureMultiplier = profile.sheltered ? 0.82 : angle === null ? 1 : angle <= 45 ? 1.18 : angle >= 135 ? 0.82 : 1;
  const evaluatedWind = env.windSpeedKmh === null ? null : env.windSpeedKmh * exposureMultiplier;
  const evaluatedGust = env.windGustKmh === null ? null : env.windGustKmh * exposureMultiplier;
  const maxWind = profile.maximumWindKmh ?? 40;
  const maxGust = profile.maximumGustKmh ?? 65;
  const maxWave = profile.maximumWaveHeightM ?? (spotType === "rock" || profile.rockAccessRequired ? 2.2 : 3);
  const rockRisk = spotType === "rock" || Boolean(profile.rockAccessRequired);
  let safetyStatus: SafetyStatus = "SAFE";
  const hardBlock = env.warningSeverity === "severe" || (rockRisk && (env.waveHeightM ?? 99) > maxWave) || (evaluatedGust ?? 0) > maxGust;
  if (hardBlock) safetyStatus = "NOT_RECOMMENDED";
  else if (env.warningSeverity === "unknown") safetyStatus = "UNKNOWN";
  else if (env.warningSeverity === "moderate" || (evaluatedGust ?? 0) > Math.min(45, maxGust * 0.8) || (rockRisk && env.waveDataStatus === "UNAVAILABLE")) safetyStatus = "HIGH_RISK";
  else if ((evaluatedWind ?? 0) > Math.min(25, maxWind) || (env.waveHeightM ?? 0) > Math.min(1.8, maxWave * 0.8)) safetyStatus = "CAUTION";
  const safetyBase = weightedScore([
    { value: inverseLinear(evaluatedWind, 12, Math.max(25, maxWind)), weight: 0.4 },
    { value: inverseLinear(evaluatedGust, 20, Math.max(35, maxGust)), weight: 0.35 },
    { value: inverseLinear(env.waveHeightM, rockRisk ? 0.8 : 1.2, Math.max(1.5, maxWave)), weight: 0.25 },
  ]);
  const safetyScore = hardBlock ? Math.min(25, safetyBase) : env.warningSeverity === "unknown" ? Math.min(60, safetyBase) : safetyBase;
  const comfortScore = weightedScore([
    { value: inverseLinear(evaluatedWind, 10, 45), weight: 0.4 },
    { value: inverseLinear(env.precipitationProbabilityPercent, 15, 90), weight: 0.25 },
    { value: env.apparentTemperatureC === null ? null : clamp(100 - Math.abs(env.apparentTemperatureC - 20) * 6), weight: 0.35 },
  ]);
  const methodSuitability = scoreMethodSuitability(env, evaluatedWind, evaluatedGust, fishingMethod, spotType);
  const baselineFishingConditionScore = clamp(weightedScore([
    { value: inverseLinear(evaluatedWind, 8, 40), weight: 0.25 },
    { value: env.pressureHpa === null ? null : clamp(75 - Math.abs(env.pressureHpa - 1016) * 2), weight: 0.2 },
    { value: env.daylightState === "day" ? 72 : 60, weight: 0.2 },
  ]) + methodSuitability.adjustment);
  const tideCondition = scoreTideCondition(env);
  const fishingConditionScore = tideCondition
    ? clamp(weightedScore([
        { value: inverseLinear(evaluatedWind, 8, 40), weight: 0.25 },
        { value: env.pressureHpa === null ? null : clamp(75 - Math.abs(env.pressureHpa - 1016) * 2), weight: 0.2 },
        { value: tideCondition.score, weight: 0.35 },
        { value: env.daylightState === "day" ? 72 : 60, weight: 0.2 },
      ]) + methodSuitability.adjustment)
    : baselineFishingConditionScore;
  const scoreStatus: ScoreResult["scoreStatus"] = tideCondition
    ? "FINAL_WITH_TIDE"
    : tideIsPending
      ? "PRELIMINARY_NO_TIDE"
      : "FINAL_NO_TIDE";
  const positives = [env.tidePhase === "rising" ? "潮位处于上升阶段" : "", (evaluatedWind ?? 99) < 20 ? "平均风速较温和" : "", exposureMultiplier < 1 ? "钓点对当前风向有遮挡" : "", (env.pressureHpa ?? 0) >= 1012 ? "气压处于稳定区间" : "", methodSuitability.adjustment >= 2 ? methodSuitability.reason : ""].filter(Boolean);
  const negatives = [(evaluatedGust ?? 0) > 30 ? "阵风可能影响抛投与舒适度" : "", exposureMultiplier > 1 ? "当前风向正对钓点暴露方向" : "", env.warningSeverity === "unknown" ? "官方警告状态暂时无法核实" : "", methodSuitability.adjustment <= -2 ? methodSuitability.reason : "", missing.length ? `缺少 ${missing.join("、")} 数据` : ""].filter(Boolean);
  return {
    safetyStatus,
    safetyScore: clamp(safetyScore),
    comfortScore: clamp(comfortScore),
    fishingConditionScore,
    baselineFishingConditionScore,
    tideConditionScore: tideCondition?.score ?? null,
    tideContributionPoints: tideCondition ? fishingConditionScore - baselineFishingConditionScore : null,
    tideScoreReason: tideCondition?.reason ?? null,
    scoreStatus,
    methodSuitabilityScore: methodSuitability.score,
    methodAdjustmentPoints: methodSuitability.adjustment,
    methodSuitabilityReason: methodSuitability.reason,
    dataConfidenceScore: clamp(env.dataQuality.overall * 100),
    confidenceReasons: env.dataQuality.reasons ?? [],
    positives,
    negatives,
    missing,
    ruleVersion: RULE_VERSION,
  };
}

export type FishingWindow = {
  startUtc: string;
  endUtc: string;
  durationHours: number;
  averageScore: number;
  averageSafetyScore: number;
  averageComfortScore: number;
  averageConfidenceScore: number;
  minimumConfidenceScore: number;
  rating: "PRIORITY" | "GOOD" | "CONDITIONAL";
  ratingLabel: string;
  summary: string;
  reasons: string[];
  cautions: string[];
};

const averageWindowMetric = (hours: Array<{ score: ScoreResult }>, key: "fishingConditionScore" | "safetyScore" | "comfortScore" | "dataConfidenceScore") => Math.round(hours.reduce((sum, hour) => sum + hour.score[key], 0) / hours.length);
const frequentWindowEvidence = (hours: Array<{ score: ScoreResult }>, key: "positives" | "negatives") => {
  const counts = new Map<string, number>();
  for (const hour of hours) for (const text of hour.score[key]) counts.set(text, (counts.get(text) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([text]) => text);
};

function evaluateWindow(hours: Array<{ timestampUtc: string; score: ScoreResult }>): FishingWindow {
  const fishing = averageWindowMetric(hours, "fishingConditionScore"),
    safety = averageWindowMetric(hours, "safetyScore"),
    comfort = averageWindowMetric(hours, "comfortScore"),
    confidence = averageWindowMetric(hours, "dataConfidenceScore"),
    minimumConfidence = Math.min(...hours.map((hour) => hour.score.dataConfidenceScore));
  const rating: FishingWindow["rating"] = fishing >= 82 && comfort >= 68 && confidence >= 70 ? "PRIORITY" : fishing >= 76 && comfort >= 58 && confidence >= 62 ? "GOOD" : "CONDITIONAL";
  const ratingLabel = rating === "PRIORITY" ? "优先考虑" : rating === "GOOD" ? "条件较好" : "条件型窗口";
  const summary = confidence < 65
    ? "环境指标达到窗口门槛，但数据可信度一般；适合顺路尝试，不建议仅凭该窗口专程远行。"
    : comfort < 60
      ? "鱼口环境达到门槛，但体感条件一般；请结合个人耐受程度决定。"
      : rating === "PRIORITY"
        ? "安全、鱼口环境、舒适度和可信度均较协调，可优先考虑。"
        : "各项达到推荐门槛，可作为本日备选出钓时段。";
  const reasons = frequentWindowEvidence(hours, "positives");
  const cautions = frequentWindowEvidence(hours, "negatives");
  if (confidence < 65) cautions.unshift("窗口数据可信度一般");
  if (comfort < 60) cautions.unshift("窗口平均舒适度偏低");
  const firstTime = new Date(hours[0].timestampUtc).getTime(),
    lastTime = new Date(hours.at(-1)!.timestampUtc).getTime();
  const intervalMs = hours.length > 1 ? Math.max(3_600_000, new Date(hours[1].timestampUtc).getTime() - firstTime) : 3_600_000;
  const validTimes = Number.isFinite(firstTime) && Number.isFinite(lastTime);
  return {
    startUtc: hours[0].timestampUtc,
    endUtc: validTimes ? new Date(lastTime + intervalMs).toISOString() : hours.at(-1)!.timestampUtc,
    durationHours: hours.length,
    averageScore: fishing,
    averageSafetyScore: safety,
    averageComfortScore: comfort,
    averageConfidenceScore: confidence,
    minimumConfidenceScore: minimumConfidence,
    rating,
    ratingLabel,
    summary,
    reasons: reasons.length ? reasons : ["连续时段达到安全、鱼口环境与可信度门槛"],
    cautions: [...new Set(cautions)].slice(0, 3),
  };
}

export function mergeWindows(hours: Array<{ timestampUtc: string; score: ScoreResult }>, minScore = 72) {
  const runs: Array<typeof hours> = [];
  let current: typeof hours = [];
  for (const hour of hours) {
    const usable = hour.score.fishingConditionScore >= minScore && hour.score.dataConfidenceScore >= 55 && hour.score.safetyStatus === "SAFE";
    if (usable) current.push(hour);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  const windows: FishingWindow[] = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    let best: { hours: typeof run; decisionIndex: number } | null = null;
    for (let length = 2; length <= Math.min(4, run.length); length += 1) {
      for (let startIndex = 0; startIndex <= run.length - length; startIndex += 1) {
        const candidate = run.slice(startIndex, startIndex + length);
        const fishing = averageWindowMetric(candidate, "fishingConditionScore"),
          safety = averageWindowMetric(candidate, "safetyScore"),
          comfort = averageWindowMetric(candidate, "comfortScore"),
          confidence = averageWindowMetric(candidate, "dataConfidenceScore");
        const decisionIndex = fishing * 0.5 + confidence * 0.25 + comfort * 0.15 + safety * 0.1 + (length - 2) * 0.35;
        if (!best || decisionIndex > best.decisionIndex) best = { hours: candidate, decisionIndex };
      }
    }
    if (best) windows.push(evaluateWindow(best.hours));
  }
  return windows;
}
