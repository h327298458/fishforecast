import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { markHealth } from "../services/health.js";

export type Applicability = "APPLICABLE" | "LOW_CONFIDENCE" | "NOT_APPLICABLE" | "UNAVAILABLE";
export const eot20Applicability = (spotType: string, waterType = ""): Applicability => {
  if (spotType === "freshwater" || /fresh/i.test(waterType)) return "NOT_APPLICABLE";
  if (["estuary", "wharf"].includes(spotType) || /harbour|estuary|river|bay|enclosed/i.test(waterType)) return "LOW_CONFIDENCE";
  return "APPLICABLE";
};

const modelRoot = () => process.env.EOT20_MODEL_PATH ?? process.env.EO_TIDES_TIDE_MODELS ?? "";

export function eot20Status() {
  const root = modelRoot();
  const oceanPath = root ? resolve(root, "EOT20", "ocean_tides") : "";
  const files = oceanPath && existsSync(oceanPath) ? readdirSync(oceanPath).filter((name) => name.endsWith("_ocean_eot20.nc")) : [];
  const manifestPath = root ? resolve(root, "EOT20", "manifest.json") : "";
  let manifest: Record<string, unknown> | null = null;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { manifest = null; }
  const ready = files.length >= 17;
  return {
    status: ready ? "REAL" : "DISABLED",
    model: "EOT20",
    version: process.env.EOT20_MODEL_VERSION ?? String(manifest?.version ?? manifest?.model ?? "EOT20"),
    modelPathConfigured: Boolean(root),
    fileCount: files.length,
    manifestHash: manifest?.archiveSha256 ?? eot20ManifestHash(),
    installedAtUtc: manifest?.installedAtUtc ?? null,
    reason: ready ? null : files.length ? "MODEL_FILES_INVALID" : "MODEL_FILES_MISSING",
  };
}

export function eot20ManifestHash() {
  const root = modelRoot();
  if (!root) return null;
  const path = resolve(root, "EOT20", "ocean_tides");
  if (!existsSync(path)) return null;
  const manifest = readdirSync(path).filter((name) => name.endsWith(".nc")).sort().map((name) => `${name}:${statSync(resolve(path, name)).size}`).join("|");
  return createHash("sha256").update(manifest).digest("hex");
}

export type Eot20Value = { timestampUtc: string; timestampLocal: string; timezone: string; heightM: number; phase: "rising"|"falling"|"slack"; changeMPerHour: number };
export type Eot20Result = {
  model: "EOT20";
  version: string;
  manifestHash: string | null;
  calculationCoordinates: { latitude: number; longitude: number };
  applicability: Applicability;
  confidence: number;
  cacheHit: boolean;
  values: Eot20Value[];
  events: Array<{ type: "HIGH"|"LOW"; timestampUtc: string; timestampLocal: string; heightM: number }>;
  dailyRanges: Array<{ dateUtc: string; rangeM: number; highM: number; lowM: number }>;
};
export type Eot20Input = { latitude: number; longitude: number; startUtc: string; endUtc: string; intervalMinutes: number; spotType: string; waterType?: string; timezone?: string };

const memoryCache = new Map<string, Eot20Result>();
export const clearEot20MemoryCache = () => memoryCache.clear();

export function eot20CacheIdentity(input: Eot20Input, model: string, version: string, manifestHash: unknown) {
  // Spot type and water type only affect applicability. The physical tide at
  // one coordinate/time range is identical and must reuse the same model run.
  return createHash("sha256").update(JSON.stringify({
    latitude: input.latitude,
    longitude: input.longitude,
    startUtc: input.startUtc,
    endUtc: input.endUtc,
    intervalMinutes: input.intervalMinutes,
    timezone: input.timezone ?? "Australia/Sydney",
    model,
    version,
    manifestHash,
  })).digest("hex");
}

const applyApplicability = (result: Eot20Result, applicability: Applicability, cacheHit: boolean): Eot20Result => ({
  ...result,
  applicability,
  confidence: applicability === "APPLICABLE" ? 0.78 : 0.42,
  cacheHit,
});

export async function calculateEot20(input: Eot20Input): Promise<Eot20Result> {
  const applicability = eot20Applicability(input.spotType, input.waterType);
  if (applicability === "NOT_APPLICABLE") throw new Error("EOT20_NOT_APPLICABLE");
  const status = eot20Status();
  if (status.status !== "REAL") throw new Error(String(status.reason));
  const key = eot20CacheIdentity(input, status.model, status.version, status.manifestHash);
  const memory = memoryCache.get(key);
  if (memory) return applyApplicability(memory, applicability, true);
  const cacheRoot = resolve(process.env.EOT20_CACHE_PATH ?? "./data/eot20-cache");
  const cacheFile = resolve(cacheRoot, `${key}.json`);
  if (existsSync(cacheFile)) {
    const disk = JSON.parse(readFileSync(cacheFile, "utf8")) as Eot20Result;
    memoryCache.set(key, disk);
    return applyApplicability(disk, applicability, true);
  }
  try {
    const raw = await runPython({
      latitude: input.latitude,
      longitude: input.longitude,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      intervalMinutes: input.intervalMinutes,
      modelPath: modelRoot(),
    });
    const timezone = input.timezone ?? "Australia/Sydney";
    const local = (utc: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(utc)).replace(" ", "T");
    const values = raw.values.map((item, index, all) => {
      const previous = all[index - 1]?.heightM ?? item.heightM;
      const changeMPerHour = (item.heightM - previous) * (60 / input.intervalMinutes);
      return { ...item, timestampLocal: local(item.timestampUtc), timezone, phase: Math.abs(changeMPerHour) < 0.01 ? "slack" as const : changeMPerHour > 0 ? "rising" as const : "falling" as const, changeMPerHour: Number(changeMPerHour.toFixed(4)) };
    });
    const events: Eot20Result["events"] = [];
    for (let index = 1; index < values.length - 1; index += 1) {
      if (values[index].heightM > values[index - 1].heightM && values[index].heightM >= values[index + 1].heightM) events.push({ type: "HIGH", timestampUtc: values[index].timestampUtc, timestampLocal: values[index].timestampLocal, heightM: values[index].heightM });
      if (values[index].heightM < values[index - 1].heightM && values[index].heightM <= values[index + 1].heightM) events.push({ type: "LOW", timestampUtc: values[index].timestampUtc, timestampLocal: values[index].timestampLocal, heightM: values[index].heightM });
    }
    const groups = new Map<string, number[]>();
    for (const value of values) {
      const date = value.timestampUtc.slice(0, 10), group = groups.get(date);
      if (group) group.push(value.heightM); else groups.set(date, [value.heightM]);
    }
    const dailyRanges = [...groups].map(([dateUtc, heights]) => {
      const highM = Math.max(...heights), lowM = Math.min(...heights);
      return { dateUtc, rangeM: Number((highM - lowM).toFixed(3)), highM, lowM };
    });
    const result: Eot20Result = { model: "EOT20", version: status.version, manifestHash: String(status.manifestHash ?? ""), calculationCoordinates: { latitude: input.latitude, longitude: input.longitude }, applicability, confidence: applicability === "APPLICABLE" ? 0.78 : 0.42, cacheHit: false, values, events, dailyRanges };
    mkdirSync(cacheRoot, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(result));
    memoryCache.set(key, result);
    markHealth("eot20", true);
    return result;
  } catch (error) {
    markHealth("eot20", false, error);
    throw error;
  }
}

function runPython(input: Record<string, unknown>): Promise<{ values: Array<{ timestampUtc: string; heightM: number }> }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.EOT20_PYTHON ?? "python", [resolve("scripts/eot20_runner.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("EOT20_TIMEOUT")); }, 120_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || "EOT20_PROCESS_FAILED"));
      else { try { resolvePromise(JSON.parse(stdout)); } catch { reject(new Error("EOT20_OUTPUT_INVALID")); } }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
