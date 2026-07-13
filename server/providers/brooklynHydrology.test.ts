import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBrooklynHydrologyCache, getBrooklynHydrology } from "./brooklynHydrology.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); clearBrooklynHydrologyCache(); });
describe("Brooklyn hydrology provider", () => {
  it("uses a real lower-Hawkesbury level series, calculates 24/72h changes and labels its tide limitation", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-13T10:30:00.000Z"));
    vi.stubGlobal("fetch", vi.fn((url: string | URL) => {
      const target = String(url);
      if (target.includes("latest-readings")) return Promise.resolve({ ok: true, json: async () => ({ "98907042": { obsdate: "2026-07-13 20:30:00", value: [1.2] } }) });
      if (target.includes("rawdatatable")) return Promise.resolve({ ok: true, json: async () => ({ summary: { "98907042": { datum: "AHD" } }, readings: { "2026-07-10 20:30:00": { "98907042": 0.5 }, "2026-07-12 20:30:00": { "98907042": 0.9 }, "2026-07-13 20:30:00": { "98907042": 1.2 } } }) });
      return Promise.resolve({ ok: true, json: async () => ({ hourly: { time: ["2026-07-13T10:00"], precipitation: [0] } }) });
    }));
    const value = await getBrooklynHydrology({ latitude: -33.5477, longitude: 151.227 });
    expect(value).toEqual(expect.objectContaining({ status: "PARTIAL", stationCode: "212431", waterLevelM: 1.2, change24hM: 0.3, change72hM: 0.7, trend: "RISING", flowM3s: null }));
    expect(value.limitation).toMatch(/tidally influenced/);
  });
  it("does not substitute a distant gauge outside the Brooklyn scope", async () => {
    const value = await getBrooklynHydrology({ latitude: -34.4, longitude: 151.21 });
    expect(value).toEqual(expect.objectContaining({ status: "NOT_APPLICABLE" }));
  });
});
