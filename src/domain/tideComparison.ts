export type OfficialComparisonEvent = {
  type: "HIGH" | "LOW";
  timeUtc: string;
  heightM: number;
};

export type ModelComparisonEvent = {
  type: "HIGH" | "LOW";
  timestampUtc: string;
  heightM: number;
};

export type TideSourceComparison<TSource extends string = string> = {
  officialHigh: OfficialComparisonEvent;
  modelHigh: ModelComparisonEvent;
  officialLow: OfficialComparisonEvent | null;
  modelLow: ModelComparisonEvent | null;
  timeDifferenceMinutes: number;
  lowTimeDifferenceMinutes: number | null;
  /** Raw heights use different vertical datums and must not be subtracted. */
  heightDifferenceM: null;
  heightDifferenceComparable: false;
  officialDatum: string;
  modelDatum: string;
  officialTidalRangeM: number | null;
  modelTidalRangeM: number | null;
  tidalRangeDifferenceM: number | null;
  modelToOfficialDisplayOffsetM: number | null;
  alignedModelHighM: number | null;
  alignedModelLowM: number | null;
  alignedHighDifferenceM: number | null;
  alignedLowDifferenceM: number | null;
  comparisonBasis: "TIDAL_RANGE_AND_CYCLE_MIDPOINT";
  officialConfidence: number;
  modelConfidence: number;
  actualTideSourceUsed: TSource;
};

const milliseconds = (value: string) => new Date(value).getTime();
const round = (value: number) => Number(value.toFixed(3));

function nextOfficialHigh(events: OfficialComparisonEvent[], referenceMs: number) {
  return events
    .filter((event) => event.type === "HIGH" && milliseconds(event.timeUtc) >= referenceMs)
    .sort((a, b) => milliseconds(a.timeUtc) - milliseconds(b.timeUtc))[0] ?? null;
}

function nearestModelHigh(events: ModelComparisonEvent[], referenceMs: number, targetMs: number) {
  return events
    .filter((event) => event.type === "HIGH" && milliseconds(event.timestampUtc) >= referenceMs)
    .sort(
      (a, b) =>
        Math.abs(milliseconds(a.timestampUtc) - targetMs) -
        Math.abs(milliseconds(b.timestampUtc) - targetMs),
    )[0] ?? null;
}

function nearestLow<T>(
  events: T[],
  highMs: number,
  timeOf: (event: T) => string,
  typeOf: (event: T) => "HIGH" | "LOW",
  targetLowMs = highMs,
) {
  const maximumCycleDistanceMs = 16 * 3_600_000;
  return events
    .filter((event) => typeOf(event) === "LOW")
    .map((event) => ({
      event,
      cycleDistance: Math.abs(milliseconds(timeOf(event)) - highMs),
      targetDistance: Math.abs(milliseconds(timeOf(event)) - targetLowMs),
    }))
    .filter(({ cycleDistance }) => cycleDistance <= maximumCycleDistanceMs)
    .sort((a, b) => a.targetDistance - b.targetDistance)[0]?.event ?? null;
}

export function compareTideSources<TSource extends string>(input: {
  officialEvents: OfficialComparisonEvent[];
  modelEvents: ModelComparisonEvent[];
  referenceTimeUtc: string;
  officialDatum?: string;
  modelDatum?: string;
  officialConfidence: number;
  modelConfidence: number;
  actualTideSourceUsed: TSource;
}): TideSourceComparison<TSource> | null {
  const referenceMs = milliseconds(input.referenceTimeUtc);
  if (!Number.isFinite(referenceMs)) return null;
  const officialHigh = nextOfficialHigh(input.officialEvents, referenceMs);
  if (!officialHigh) return null;
  const officialHighMs = milliseconds(officialHigh.timeUtc);
  const modelHigh = nearestModelHigh(input.modelEvents, referenceMs, officialHighMs);
  if (!modelHigh) return null;
  const modelHighMs = milliseconds(modelHigh.timestampUtc);
  const officialLow = nearestLow(
    input.officialEvents,
    officialHighMs,
    (event) => event.timeUtc,
    (event) => event.type,
  );
  const modelLow = nearestLow(
    input.modelEvents,
    modelHighMs,
    (event) => event.timestampUtc,
    (event) => event.type,
    officialLow ? milliseconds(officialLow.timeUtc) : modelHighMs,
  );
  const hasRanges = Boolean(officialLow && modelLow);
  const officialRange = officialLow
    ? Math.abs(officialHigh.heightM - officialLow.heightM)
    : null;
  const modelRange = modelLow
    ? Math.abs(modelHigh.heightM - modelLow.heightM)
    : null;
  const displayOffset = hasRanges
    ? (officialHigh.heightM + officialLow!.heightM) / 2 -
      (modelHigh.heightM + modelLow!.heightM) / 2
    : null;
  const alignedModelHigh = displayOffset === null ? null : modelHigh.heightM + displayOffset;
  const alignedModelLow = displayOffset === null ? null : modelLow!.heightM + displayOffset;

  return {
    officialHigh,
    modelHigh,
    officialLow,
    modelLow,
    timeDifferenceMinutes: Math.round(Math.abs(officialHighMs - modelHighMs) / 60_000),
    lowTimeDifferenceMinutes:
      officialLow && modelLow
        ? Math.round(
            Math.abs(milliseconds(officialLow.timeUtc) - milliseconds(modelLow.timestampUtc)) /
              60_000,
          )
        : null,
    heightDifferenceM: null,
    heightDifferenceComparable: false,
    officialDatum: input.officialDatum ?? "Lowest Astronomical Tide (LAT)",
    modelDatum: input.modelDatum ?? "Mean Sea Level (MSL)",
    officialTidalRangeM: officialRange === null ? null : round(officialRange),
    modelTidalRangeM: modelRange === null ? null : round(modelRange),
    tidalRangeDifferenceM:
      officialRange === null || modelRange === null
        ? null
        : round(Math.abs(officialRange - modelRange)),
    modelToOfficialDisplayOffsetM: displayOffset === null ? null : round(displayOffset),
    alignedModelHighM: alignedModelHigh === null ? null : round(alignedModelHigh),
    alignedModelLowM: alignedModelLow === null ? null : round(alignedModelLow),
    alignedHighDifferenceM:
      alignedModelHigh === null
        ? null
        : round(Math.abs(officialHigh.heightM - alignedModelHigh)),
    alignedLowDifferenceM:
      alignedModelLow === null || !officialLow
        ? null
        : round(Math.abs(officialLow.heightM - alignedModelLow)),
    comparisonBasis: "TIDAL_RANGE_AND_CYCLE_MIDPOINT",
    officialConfidence: input.officialConfidence,
    modelConfidence: input.modelConfidence,
    actualTideSourceUsed: input.actualTideSourceUsed,
  };
}
