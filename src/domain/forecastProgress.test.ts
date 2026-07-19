import { describe, expect, it } from "vitest";
import {
  createForecastProgress,
  updateForecastProgress,
} from "./forecastProgress";

describe("forecast progress", () => {
  it("starts with the base request running and later work pending", () => {
    const progress = createForecastProgress(7);
    expect(progress.requestId).toBe(7);
    expect(progress.stages.map((stage) => stage.status)).toEqual([
      "running",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("updates only the requested stages", () => {
    const progress = updateForecastProgress(createForecastProgress(8), [
      { id: "base", status: "completed", detail: "Weather ready" },
      { id: "eot20", status: "running", detail: "Model running" },
    ]);
    expect(progress.stages.find((stage) => stage.id === "base")).toMatchObject({
      status: "completed",
      detail: "Weather ready",
    });
    expect(
      progress.stages.find((stage) => stage.id === "official")?.status,
    ).toBe("pending");
    expect(progress.stages.find((stage) => stage.id === "eot20")?.status).toBe(
      "running",
    );
  });
});
