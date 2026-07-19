import { describe, expect, it } from "vitest";
import {
  resolveActualTideSource,
  shouldCalculateEot20ForForecast,
} from "./tideSelection.js";
import { interpolateEot20 } from "./forecast.js";

describe("forecast tide source selection", () => {
  it("transparently falls back to an installed EOT20 model when the default official source has no events", () => {
    const common = {
      preferredSource: "BOM_OFFICIAL" as const,
      officialAvailable: false,
      officialStationLocked: false,
      modelInstalled: true,
      modelApplicable: true,
    };
    expect(shouldCalculateEot20ForForecast(common)).toBe(true);
    expect(
      resolveActualTideSource({
        preferredSource: common.preferredSource,
        officialAvailable: false,
        officialStationLocked: false,
        modelAvailable: true,
      }),
    ).toBe("EOT20_MODEL");
  });

  it("does not override an explicitly locked official station", () => {
    expect(
      shouldCalculateEot20ForForecast({
        preferredSource: "BOM_OFFICIAL",
        officialAvailable: false,
        officialStationLocked: true,
        modelInstalled: true,
        modelApplicable: true,
      }),
    ).toBe(false);
  });

  it("keeps NO_TIDE intentional and avoids EOT20 for freshwater", () => {
    expect(
      shouldCalculateEot20ForForecast({
        preferredSource: "NO_TIDE",
        officialAvailable: false,
        officialStationLocked: false,
        modelInstalled: true,
        modelApplicable: true,
      }),
    ).toBe(false);
    expect(
      shouldCalculateEot20ForForecast({
        preferredSource: "BOM_OFFICIAL",
        officialAvailable: false,
        officialStationLocked: false,
        modelInstalled: true,
        modelApplicable: false,
      }),
    ).toBe(false);
  });

  it("never extrapolates the first model value backwards", () => {
    const values = [
      { timestampUtc: "2026-07-19T06:00:00.000Z", heightM: -0.1, phase: "falling" as const },
      { timestampUtc: "2026-07-19T07:00:00.000Z", heightM: -0.3, phase: "falling" as const },
    ];
    expect(interpolateEot20(values, "2026-07-19T00:00:00.000Z")).toBeNull();
    expect(interpolateEot20(values, "2026-07-19T06:00:00.000Z")).toEqual({
      heightM: -0.1,
      phase: "falling",
    });
  });
});
