import { describe, expect, it } from "vitest";
import { localMinuteOfDay, makeTidePathSegments } from "../domain/tideChart";
import type { TideChartPoint } from "../domain/tideChart";

const hour = (timestampLocal: string, tideHeightM: number | null) =>
  ({ timestampLocal, timestampUtc: `${timestampLocal}Z`, tideHeightM }) as TideChartPoint;

describe("tide chart time geometry", () => {
  it("positions real values by local clock time instead of spreading a partial day across 24 hours", () => {
    const segments = makeTidePathSegments([
      hour("2026-07-19T16:00:00", -0.1),
      hour("2026-07-19T17:00:00", -0.25),
      hour("2026-07-19T18:00:00", -0.32),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].startX).toBe(480);
    expect(segments[0].endX).toBe(540);
    expect(segments[0].areaPath).not.toContain("L 0 170");
  });

  it("does not draw a line across missing tide hours", () => {
    const segments = makeTidePathSegments([
      hour("2026-07-19T00:00:00", null),
      hour("2026-07-19T01:00:00", null),
      hour("2026-07-19T16:00:00", -0.1),
      hour("2026-07-19T17:00:00", -0.25),
    ]);
    expect(segments[0].startX).toBe(480);
  });

  it("parses both ISO-local and provider-local timestamps", () => {
    expect(localMinuteOfDay("2026-07-19T18:30:00")).toBe(1110);
    expect(localMinuteOfDay("2026-07-19 06:05")).toBe(365);
  });
});
