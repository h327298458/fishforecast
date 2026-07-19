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

  it("recognises the VALID status written by the official importers", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO tide_imports (id,provider,source_type,source_year,state,station_id,station_name,original_filename,source_url,downloaded_at_utc,file_sha256,attribution,parser_version,parse_status,row_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "import-2027", "BOM", "BOM_OFFICIAL_STATION", 2027, "NSW", "NSW_TP007", "Sydney", "source.pdf", "https://example.invalid/source.pdf", "2026-07-01T00:00:00Z", "hash", "BOM", "test", "VALID", 1_411,
    );
    const result = checkOfficialTideYears(db, new Date("2026-07-19T00:00:00Z"));
    expect(result.nextYearAvailable).toBe(true);
    expect(result.actionRequired).toBe(false);
    db.close();
  });
});
