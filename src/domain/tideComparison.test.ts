import { describe, expect, it } from "vitest";
import { compareTideSources } from "./tideComparison";

describe("datum-safe tide comparison", () => {
  it("compares event timing and tidal range without subtracting LAT and MSL heights", () => {
    const comparison = compareTideSources({
      referenceTimeUtc: "2026-07-21T00:00:00Z",
      officialEvents: [
        { type: "HIGH", timeUtc: "2026-07-21T03:55:00Z", heightM: 1.5 },
        { type: "LOW", timeUtc: "2026-07-21T10:11:00Z", heightM: 0.76 },
      ],
      modelEvents: [
        { type: "HIGH", timestampUtc: "2026-07-21T04:00:00Z", heightM: 0.505 },
        { type: "LOW", timestampUtc: "2026-07-21T10:00:00Z", heightM: -0.247 },
      ],
      officialDatum: "Lowest Astronomical Tide (LAT)",
      modelDatum: "Mean Sea Level (MSL)",
      officialConfidence: 0.9,
      modelConfidence: 0.42,
      actualTideSourceUsed: "BOM_OFFICIAL",
    });

    expect(comparison).not.toBeNull();
    expect(comparison?.timeDifferenceMinutes).toBe(5);
    expect(comparison?.heightDifferenceM).toBeNull();
    expect(comparison?.heightDifferenceComparable).toBe(false);
    expect(comparison?.officialTidalRangeM).toBe(0.74);
    expect(comparison?.modelTidalRangeM).toBe(0.752);
    expect(comparison?.tidalRangeDifferenceM).toBe(0.012);
    expect(comparison?.modelToOfficialDisplayOffsetM).toBeCloseTo(1.001, 3);
    expect(comparison?.alignedHighDifferenceM).toBe(0.006);
    expect(comparison?.alignedLowDifferenceM).toBe(0.006);
  });

  it("pairs the model high and low nearest to the same official cycle", () => {
    const comparison = compareTideSources({
      referenceTimeUtc: "2026-07-21T00:00:00Z",
      officialEvents: [
        { type: "LOW", timeUtc: "2026-07-20T21:00:00Z", heightM: 0.5 },
        { type: "HIGH", timeUtc: "2026-07-21T04:00:00Z", heightM: 1.5 },
        { type: "LOW", timeUtc: "2026-07-21T10:00:00Z", heightM: 0.7 },
      ],
      modelEvents: [
        { type: "HIGH", timestampUtc: "2026-07-20T15:00:00Z", heightM: 0.4 },
        { type: "LOW", timestampUtc: "2026-07-20T21:00:00Z", heightM: -0.4 },
        { type: "HIGH", timestampUtc: "2026-07-21T04:00:00Z", heightM: 0.5 },
        { type: "LOW", timestampUtc: "2026-07-21T10:00:00Z", heightM: -0.2 },
      ],
      officialConfidence: 0.9,
      modelConfidence: 0.42,
      actualTideSourceUsed: "EOT20_MODEL",
    });

    expect(comparison?.modelHigh.timestampUtc).toBe("2026-07-21T04:00:00Z");
    expect(comparison?.officialLow?.timeUtc).toBe("2026-07-21T10:00:00Z");
    expect(comparison?.modelLow?.timestampUtc).toBe("2026-07-21T10:00:00Z");
  });

  it("keeps both sources on the same side of a high when the nearest model low is ambiguous", () => {
    const comparison = compareTideSources({
      referenceTimeUtc: "2026-07-21T00:00:00Z",
      officialEvents: [
        { type: "LOW", timeUtc: "2026-07-20T23:30:00Z", heightM: 0.5 },
        { type: "HIGH", timeUtc: "2026-07-21T04:00:00Z", heightM: 1.5 },
        { type: "LOW", timeUtc: "2026-07-21T09:00:00Z", heightM: 0.7 },
      ],
      modelEvents: [
        { type: "LOW", timestampUtc: "2026-07-20T23:35:00Z", heightM: -0.3 },
        { type: "HIGH", timestampUtc: "2026-07-21T05:00:00Z", heightM: 0.5 },
        { type: "LOW", timestampUtc: "2026-07-21T09:05:00Z", heightM: -0.1 },
      ],
      officialConfidence: 0.9,
      modelConfidence: 0.42,
      actualTideSourceUsed: "EOT20_MODEL",
    });

    expect(comparison?.officialLow?.timeUtc).toBe("2026-07-20T23:30:00Z");
    expect(comparison?.modelLow?.timestampUtc).toBe("2026-07-20T23:35:00Z");
  });
});
