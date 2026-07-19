import type { HourlyEnvironment, ScoreResult, SafetyStatus } from "./types.js";

export const RULE_VERSION = "2026.07-trust.3";
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
export const angularDifference = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
export const weightedScore = (items: Array<{ value: number | null; weight: number }>) => {
  const usable = items.filter((item): item is { value: number; weight: number } => item.value !== null);
  const weight = usable.reduce((sum, item) => sum + item.weight, 0);
  return weight ? usable.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0;
};
const inverseLinear = (value: number | null, ideal: number, bad: number) => value === null ? null : clamp(100 - Math.max(0, value - ideal) * (100 / Math.max(bad - ideal, 1)));

export type SpotSafetyProfile = {
  exposureDirectionDeg?: number | null;
  maximumWindKmh?: number | null;
  maximumGustKmh?: number | null;
  maximumWaveHeightM?: number | null;
  openCoast?: boolean;
  rockAccessRequired?: boolean;
  sheltered?: boolean;
};

export function scoreHour(env: HourlyEnvironment, spotType = "wharf", profile: SpotSafetyProfile = {}): ScoreResult {
  const waveIsDeliberatelyExcluded = env.waveDataStatus === "LOW_CONFIDENCE" || env.waveDataStatus === "NOT_APPLICABLE";
  const missing = Object.entries({ wind: env.windSpeedKmh, gust: env.windGustKmh, pressure: env.pressureHpa, tide: env.tideHeightM, wave: waveIsDeliberatelyExcluded ? 0 : env.waveHeightM }).filter(([, value]) => value === null).map(([key]) => key);
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
  const fishingConditionScore = weightedScore([
    { value: inverseLinear(evaluatedWind, 8, 40), weight: 0.25 },
    { value: env.pressureHpa === null ? null : clamp(75 - Math.abs(env.pressureHpa - 1016) * 2), weight: 0.2 },
    { value: env.tidePhase === null ? null : env.tidePhase === "rising" ? 86 : env.tidePhase === "falling" ? 72 : 55, weight: 0.35 },
    { value: env.daylightState === "day" ? 72 : 60, weight: 0.2 },
  ]);
  const positives = [env.tidePhase === "rising" ? "潮位处于上升阶段" : "", (evaluatedWind ?? 99) < 20 ? "平均风速较温和" : "", exposureMultiplier < 1 ? "钓点对当前风向有遮挡" : "", (env.pressureHpa ?? 0) >= 1012 ? "气压处于稳定区间" : ""].filter(Boolean);
  const negatives = [(evaluatedGust ?? 0) > 30 ? "阵风可能影响抛投与舒适度" : "", exposureMultiplier > 1 ? "当前风向正对钓点暴露方向" : "", env.warningSeverity === "unknown" ? "官方警告状态暂时无法核实" : "", missing.length ? `缺少 ${missing.join("、")} 数据` : ""].filter(Boolean);
  return { safetyStatus, safetyScore: clamp(safetyScore), comfortScore: clamp(comfortScore), fishingConditionScore: clamp(fishingConditionScore), dataConfidenceScore: clamp(env.dataQuality.overall * 100), confidenceReasons: env.dataQuality.reasons ?? [], positives, negatives, missing, ruleVersion: RULE_VERSION };
}

export function mergeWindows(hours: Array<{ timestampUtc: string; score: ScoreResult }>, minScore = 72) {
  const windows: Array<{ startUtc: string; endUtc: string; averageScore: number }> = [];
  let current: typeof hours = [];
  for (const hour of hours) {
    const usable = hour.score.fishingConditionScore >= minScore && hour.score.dataConfidenceScore >= 55 && hour.score.safetyStatus === "SAFE";
    if (usable) current.push(hour);
    if ((!usable || hour === hours.at(-1)) && current.length) {
      if (current.length >= 2) {
        let best: typeof current | null = null;
        const targetLength = Math.min(current.length, 5);
        for (let startIndex = 0; startIndex < current.length - 1; startIndex += 1) {
          const candidate = current.slice(startIndex, startIndex + targetLength);
          if (candidate.length !== targetLength) continue;
          const candidateAverage = candidate.reduce((sum, item) => sum + item.score.fishingConditionScore, 0) / candidate.length;
          const bestAverage = best ? best.reduce((sum, item) => sum + item.score.fishingConditionScore, 0) / best.length : -1;
          if (!best || candidateAverage > bestAverage) best = candidate;
        }
        if (best) windows.push({ startUtc: best[0].timestampUtc, endUtc: best.at(-1)!.timestampUtc, averageScore: Math.round(best.reduce((sum, item) => sum + item.score.fishingConditionScore, 0) / best.length) });
      }
      current = [];
    }
  }
  return windows;
}
