import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../db/applyMigrations.js";
import { nearestOfficialStations, officialEvents } from "../providers/bomOfficialTide.js";
import { bootstrapOfficialTides } from "./officialTideBootstrap.js";

describe("official tide startup bootstrap", () => {
  it("imports bundled official files once and matches Brooklyn Baths to Sydney", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const first = await bootstrapOfficialTides(db, "data/raw/tides");
    expect(first.status).toBe("READY");
    expect(first.importedFiles).toBe(13);
    expect(first.stationCount).toBe(7);
    expect(first.eventCount).toBeGreaterThan(16_000);

    const [nearest] = nearestOfficialStations(db, { latitude: -33.538, longitude: 151.221 }) as Array<Record<string, unknown> & { distanceKm: number }>;
    expect(nearest.station_id).toBe("NSW_TP007");
    expect(nearest.station_name).toBe("SYDNEY (FORT DENISON)");
    expect(nearest.distanceKm).toBeLessThan(40);
    expect(officialEvents(db, "NSW_TP007", "2026-07-19T00:00:00Z", "2026-07-26T00:00:00Z").length).toBeGreaterThan(20);

    const second = await bootstrapOfficialTides(db, "data/raw/tides");
    expect(second.importedFiles).toBe(0);
    expect(second.skippedFiles).toBe(13);
    expect(second.eventCount).toBe(first.eventCount);
    db.close();
  }, 20_000);
});
