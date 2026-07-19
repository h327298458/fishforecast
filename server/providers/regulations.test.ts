import { describe, expect, it } from "vitest";
import { getRegulationEntry } from "./regulations.js";
describe("official regulation entries", () => {
  it("returns verified government entry points for every Australian jurisdiction", () => { for (const state of ["NSW", "QLD", "VIC", "WA", "SA", "TAS", "NT", "ACT"]) { const entry = getRegulationEntry(state); expect(entry.status).toBe("REAL"); expect(entry.rulesUrl).toMatch(/^https:\/\//); expect(entry.lastVerifiedAt).toBe("2026-07-19"); } });
  it("does not claim rules for an unknown jurisdiction", () => expect(getRegulationEntry("unknown").status).toBe("NOT_APPLICABLE"));
});
