export type SafetyStatus = 'SAFE' | 'CAUTION' | 'HIGH_RISK' | 'NOT_RECOMMENDED' | 'UNKNOWN';
export type HourlyEnvironment = {
  timestampUtc: string; timestampLocal: string; timezone: string;
  temperatureC: number | null; apparentTemperatureC: number | null; humidityPercent: number | null;
  precipitationProbabilityPercent: number | null; precipitationMm: number | null;
  windSpeedKmh: number | null; windGustKmh: number | null; windDirectionDeg: number | null;
  pressureHpa: number | null; pressureTrendHpa3h: number | null; cloudCoverPercent: number | null;
  waveHeightM: number | null; swellHeightM: number | null; swellPeriodSeconds: number | null;
  /** Distinguishes an unavailable provider from a deliberate applicability exclusion. */
  waveDataStatus?: 'AVAILABLE'|'LOW_CONFIDENCE'|'NOT_APPLICABLE'|'UNAVAILABLE';
  modelSeaLevelTrendM: number | null;
  tideHeightM: number | null; tidePhase: 'rising'|'falling'|'slack'|null;
  warningSeverity: 'none'|'minor'|'moderate'|'severe'|'unknown'; daylightState: 'day'|'night';
  sources: Record<string,string>; fetchedAtUtc: string;
  dataQuality: {
    weather: number; marine: number; tide: number; warnings: number;
    observations?: number; overall: number;
    /** Human-readable inputs behind the confidence score; never a hidden constant. */
    reasons?: string[];
  };
};
export type ScoreResult = { safetyStatus: SafetyStatus; safetyScore: number; comfortScore: number; fishingConditionScore: number; dataConfidenceScore: number; confidenceReasons: string[]; positives: string[]; negatives: string[]; missing: string[]; ruleVersion: string };
