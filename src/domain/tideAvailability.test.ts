import { describe, expect, it } from "vitest";
import { canSelectEot20 } from "./tideAvailability";

describe("EOT20 UI availability", () => {
  it("allows an installed model that has not been calculated yet", () => {
    expect(canSelectEot20({ available: true, status: "NOT_REQUESTED" })).toBe(true);
    expect(canSelectEot20({ status: "NOT_REQUESTED", reason: "ON_DEMAND_MODEL_NOT_REQUESTED" })).toBe(true);
  });

  it("allows already calculated events", () => {
    expect(canSelectEot20({ status: "available", events: [{}] })).toBe(true);
  });

  it("disables a genuinely missing model", () => {
    expect(canSelectEot20({ available: false, status: "UNAVAILABLE", reason: "MODEL_FILES_MISSING" })).toBe(false);
  });
});
