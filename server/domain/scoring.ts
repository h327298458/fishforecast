import type { HourlyEnvironment, ScoreResult, SafetyStatus } from './types.js';

export const RULE_VERSION = '2026.07-trust.2';
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
export const angularDifference = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
export const weightedScore = (items: Array<{ value: number | null; weight: number }>) => {
  const usable = items.filter((item): item is { value: number; weight: number } => item.value !== null);
  const weight = usable.reduce((sum, item) => sum + item.weight, 0);
  return weight ? usable.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0;
};
const inverseLinear = (value: number | null, ideal: number, bad: number) => value === null ? null : clamp(100 - Math.max(0, value - ideal) * (100 / (bad - ideal)));

export function scoreHour(env: HourlyEnvironment, spotType = 'wharf'): ScoreResult {
  // A harbour, estuary or freshwater point deliberately does not receive an
  // offshore wave value.  That is an applicability decision, not missing data.
  const waveIsDeliberatelyExcluded = env.waveDataStatus === 'LOW_CONFIDENCE' || env.waveDataStatus === 'NOT_APPLICABLE';
  const missing = Object.entries({ wind: env.windSpeedKmh, gust: env.windGustKmh, pressure: env.pressureHpa, tide: env.tideHeightM, wave: waveIsDeliberatelyExcluded ? 0 : env.waveHeightM }).filter(([,v]) => v === null).map(([k]) => k);
  let safetyStatus: SafetyStatus = 'SAFE';
  const hardBlock = env.warningSeverity === 'severe' || (spotType === 'rock' && (env.waveHeightM ?? 99) > 2.2) || (env.windGustKmh ?? 0) > 65;
  if (hardBlock) safetyStatus = 'NOT_RECOMMENDED';
  else if (env.warningSeverity === 'unknown') safetyStatus = 'UNKNOWN';
  else if (env.warningSeverity === 'moderate' || (env.windGustKmh ?? 0) > 45 || (spotType === 'rock' && env.waveDataStatus === 'UNAVAILABLE')) safetyStatus = 'HIGH_RISK';
  else if ((env.windSpeedKmh ?? 0) > 25 || (env.waveHeightM ?? 0) > 1.8) safetyStatus = 'CAUTION';
  const safetyBase = weightedScore([{ value: inverseLinear(env.windSpeedKmh, 12, 55), weight: 0.4 }, { value: inverseLinear(env.windGustKmh, 20, 70), weight: 0.35 }, { value: inverseLinear(env.waveHeightM, spotType === 'rock' ? .8 : 1.2, 3), weight: 0.25 }]);
  const safetyScore = hardBlock ? Math.min(25, safetyBase) : env.warningSeverity === 'unknown' ? Math.min(60,safetyBase) : safetyBase;
  const comfortScore = weightedScore([{ value: inverseLinear(env.windSpeedKmh, 10, 45), weight: .4 }, { value: inverseLinear(env.precipitationProbabilityPercent, 15, 90), weight: .25 }, { value: env.apparentTemperatureC === null ? null : clamp(100 - Math.abs(env.apparentTemperatureC - 20) * 6), weight: .35 }]);
  const fishingConditionScore = weightedScore([{ value: inverseLinear(env.windSpeedKmh, 8, 40), weight: .25 }, { value: env.pressureHpa === null ? null : clamp(75 - Math.abs(env.pressureHpa - 1016) * 2), weight: .2 }, { value: env.tidePhase === null ? null : env.tidePhase === 'rising' ? 86 : env.tidePhase === 'falling' ? 72 : 55, weight: .35 }, { value: env.daylightState === 'day' ? 72 : 60, weight: .2 }]);
  const positives = [env.tidePhase === 'rising' ? '潮位处于上升阶段' : '', (env.windSpeedKmh ?? 99) < 20 ? '平均风速较温和' : '', (env.pressureHpa ?? 0) >= 1012 ? '气压处于稳定区间' : ''].filter(Boolean);
  const negatives = [(env.windGustKmh ?? 0) > 30 ? '阵风可能影响抛投与舒适度' : '', env.warningSeverity === 'unknown' ? '官方警告状态暂时无法核实' : '', missing.length ? `缺少 ${missing.join('、')} 数据` : ''].filter(Boolean);
  return { safetyStatus, safetyScore: clamp(safetyScore), comfortScore: clamp(comfortScore), fishingConditionScore: clamp(fishingConditionScore), dataConfidenceScore: clamp(env.dataQuality.overall * 100), positives, negatives, missing, ruleVersion: RULE_VERSION };
}

export function mergeWindows(hours: Array<{ timestampUtc: string; score: ScoreResult }>, minScore = 68) {
  const windows: Array<{ startUtc: string; endUtc: string; averageScore: number }> = [];
  let current: typeof hours = [];
  for (const hour of hours) {
    const usable = hour.score.fishingConditionScore >= minScore && hour.score.dataConfidenceScore >= 45 && !['UNKNOWN','HIGH_RISK','NOT_RECOMMENDED'].includes(hour.score.safetyStatus);
    if (usable) current.push(hour);
    if ((!usable || hour === hours.at(-1)) && current.length) {
      if (current.length >= 2) windows.push({ startUtc: current[0].timestampUtc, endUtc: current.at(-1)!.timestampUtc, averageScore: Math.round(current.reduce((s,h)=>s+h.score.fishingConditionScore,0)/current.length) });
      current = [];
    }
  }
  return windows;
}
