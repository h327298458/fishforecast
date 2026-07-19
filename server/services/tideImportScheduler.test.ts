import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../db/applyMigrations.js";
import { checkOfficialTideYears } from "./tideImportScheduler.js";

describe("official tide year checker", () => {
  it("honestly reports next-year import action without downloading unverified files", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const result = checkOfficialTideYears(db, new Date("2026-07-19T00:00:00Z"));
    expect(result.nextYear).toBe(2027);
    expect(result.nextYearAvailable).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.status).toBe("PARTIAL");
    db.close();
  });
});
