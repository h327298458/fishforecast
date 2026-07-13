export type SafetyStatus =
  "SAFE" | "CAUTION" | "HIGH_RISK" | "NOT_RECOMMENDED" | "UNKNOWN";
export type LocationPoint = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  state: string;
  timezone: string;
  countryCode?: "AU";
};
export type SavedSpot = LocationPoint & {
  spotType: string;
  fishingMethod: string;
  waterType?: string;
  targetSpecies?: string | null;
  createdAtUtc?: string;
  preferredTideSource?: TideSource;
};
export type Score = {
  safetyStatus: SafetyStatus;
  safetyScore: number;
  comfortScore: number;
  fishingConditionScore: number;
  dataConfidenceScore: number;
  positives: string[];
  negatives: string[];
  missing: string[];
  ruleVersion: string;
};
export type Hour = {
  timestampUtc: string;
  timestampLocal: string;
  temperatureC: number | null;
  precipitationProbabilityPercent: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  pressureHpa: number | null;
  waveHeightM: number | null;
  swellPeriodSeconds: number | null;
  modelSeaLevelTrendM: number | null;
  tideHeightM: number | null;
  tidePhase: string | null;
  warningSeverity: string;
  sources: Record<string, string>;
  score: Score;
};
export type Window = { startUtc: string; endUtc: string; averageScore: number };
export type Day = { date: string; hours: Hour[]; windows: Window[] };
export type ProviderState = {
  status:
    | "available"
    | "unavailable"
    | "request_failed"
    | "no_data"
    | "not_applicable";
  provider: string;
  reason?: string | null;
};
export type TideSource = "BOM_OFFICIAL" | "EOT20_MODEL" | "NO_TIDE";
export type Forecast = {
  snapshotId?: string | null;
  spot: SavedSpot;
  days: Day[];
  providerStatus: Record<string, ProviderState>;
  degraded: boolean;
  generatedAtUtc: string;
  tides: {
    selectedSource: TideSource;
    preferredSource: TideSource;
    actualTideSourceUsed: TideSource;
    fallbackReason: string | null;
    official: null | {
      station: Record<string, string | number>;
      events: Array<{ type: "HIGH" | "LOW"; timeUtc: string; heightM: number }>;
      timeOffsetMinutes: number;
      heightOffsetM: number;
      stationLocked: boolean;
      candidates: Array<Record<string,string|number>>;
      interpolationNotice: string;
    };
    model: Record<string, unknown> & {
      events?: Array<{
        type: "HIGH" | "LOW";
        timestampUtc: string;
        heightM: number;
      }>;
      applicability?: string;
    };
    comparison: null | {
      timeDifferenceMinutes: number;
      heightDifferenceM: number;
      officialHigh: { timeUtc: string; heightM: number };
      modelHigh: { timestampUtc: string; heightM: number };
      officialLow: null|{ timeUtc:string;heightM:number };
      modelLow: null|{ timestampUtc:string;heightM:number };
      lowTimeDifferenceMinutes:number|null;
      officialConfidence:number;
      modelConfidence:number;
      actualTideSourceUsed:TideSource;
    };
  };
  warnings: {
    warnings?: Array<{
      warningId: string;
      title: string;
      severity: string;
      sourceUrl: string;
      issuedAtUtc: string;
      validFromUtc?:string|null;
      validUntilUtc?:string|null;
      affectedAreaText?:string;
      matchStatus?:'AFFECTED'|'POSSIBLY_AFFECTED'|'NOT_AFFECTED';
      matchReason?:string;
      lifecycle?:'ACTIVE'|'FINAL'|'CANCELLED';
    }>;
    sourceUrl?: string;
    usingStaleCache?: boolean;
    status?: string;
    reason?: string;
    matchStatus?:string;
    checkedAtUtc?:string;
  };
  observation: {
    selected?: {
      stationName: string;
      distanceKm: number;
      observedAtUtc: string;
      windSpeedKmh: number | null;
      gustKmh: number | null;
      temperatureC: number | null;
      pressureHpa: number | null;
      rainSince9amMm: number | null;
      ageMinutes?:number;
      fieldCompleteness?:number;
      selectionReason?:string;
    };
    status?: string;
    reason?: string;
    candidates?:Array<Forecast['observation']['selected']>;
    forecastVsObservation?:{forecastWindKmh:number|null;observedWindKmh:number|null;observedGustKmh:number|null;windDifferenceKmh:number|null;affectsSafety:boolean;affectsComfort:boolean}|null;
  };
  bomMarineForecast: {
    productCode?: string;
    zone?: string;
    text?: string;
    sourceUrl?: string;
    usingStaleCache?: boolean;
    status?: string;
    reason?: string;
  };
  nswMhlWave: {
    provider?: string;
    stationName?: string;
    stationCode?: string;
    stationLatitude?: number;
    stationLongitude?: number;
    distanceToSpotKm?: number;
    observationTimeUtc?: string;
    significantWaveHeightM?: number | null;
    maximumWaveHeightM?: number | null;
    wavePeriodSeconds?: number | null;
    waveDirectionDeg?: number | null;
    seaTemperatureC?: number | null;
    applicability?: string;
    applicabilityReason?: string;
    sourceUrl?: string;
    fetchedAtUtc?: string;
    usingStaleCache?: boolean;
    status?: string;
    reason?: string;
  };
  waterData: {
    status: string;
    provider?: string;
    stationName?: string;
    stationCode?: string;
    distanceToSpotKm?: number;
    observedAtUtc?: string;
    waterLevelM?: number;
    datum?: string | null;
    change24hM?: number | null;
    change72hM?: number | null;
    trend?: string;
    flowM3s?: number | null;
    upstreamRain?: { source: string; referenceArea: string; past24hMm: number; past72hMm: number; future24hMm: number };
    sourceUrl?: string;
    usingStaleCache?: boolean;
    limitation?: string;
    detail?: string;
  };
  marineApplicability: {
    status: string;
    gridDistanceKm: number | null;
    reason: string | null;
    requestedCoordinates: { latitude: number; longitude: number };
    returnedCoordinates: { latitude: number; longitude: number } | null;
  };
};
export type FishingLog = {
  id: string;
  spotId: string;
  startedAtUtc: string;
  endedAtUtc: string;
  method: string;
  bait: string | null;
  bites: number;
  catches: number;
  rating: number;
  notes: string | null;
  forecastSnapshotId?: string | null;
  gearIssues?: string | null;
  detailsJson?: string;
  comparisonJson?: string | null;
};
