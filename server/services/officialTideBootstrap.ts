import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { importMsqTideFile } from "../providers/bomOfficialTide.js";
import { importBomNswTideFile } from "../providers/bomNswTide.js";

type NswManifestRecord = {
  year: number;
  stationId: string;
  filename: string;
  sourceUrl: string;
  downloadedAtUtc: string;
  sha256: string;
};

export type OfficialTideBootstrapState = {
  status: "READY" | "PARTIAL" | "UNAVAILABLE";
  source: "BUNDLED_OFFICIAL_FILES";
  importedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  stationCount: number;
  eventCount: number;
  completedAtUtc: string;
  errors: string[];
};

const defaultSeedRoot = () => {
  if (process.env.OFFICIAL_TIDE_SEED_PATH) return resolve(process.env.OFFICIAL_TIDE_SEED_PATH);
  if (existsSync("/app/seed-data/tides")) return "/app/seed-data/tides";
  return resolve("data/raw/tides");
};

const validEventCount = (db: Database.Database, stationId: string, sourceYear: number) => Number((db.prepare(
  "SELECT COUNT(*) AS count FROM tide_events WHERE station_id=? AND source_year=?",
).get(stationId, sourceYear) as { count: number } | undefined)?.count ?? 0);

const alreadyImported = (db: Database.Database, stationId: string, sourceYear: number, minimumEvents: number) => {
  const validImport = db.prepare(
    "SELECT 1 FROM tide_imports WHERE station_id=? AND source_year=? AND parse_status='VALID' LIMIT 1",
  ).get(stationId, sourceYear);
  return Boolean(validImport) && validEventCount(db, stationId, sourceYear) >= minimumEvents;
};

async function extractPdfText(binary: Buffer) {
  const document = await getDocument({ data: new Uint8Array(binary), verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return pages.join(" ");
  } finally {
    await document.destroy();
  }
}

export async function bootstrapOfficialTides(db: Database.Database, seedRoot = defaultSeedRoot()): Promise<OfficialTideBootstrapState> {
  let importedFiles = 0, skippedFiles = 0;
  const errors: string[] = [];
  const nswRoot = resolve(seedRoot, "bom-nsw");
  const manifestPath = resolve(nswRoot, "downloads-manifest.json");

  if (existsSync(manifestPath)) {
    try {
      const records = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")) as NswManifestRecord[];
      for (const record of records) {
        try {
          if (alreadyImported(db, record.stationId, record.year, 1_300)) {
            skippedFiles += 1;
            continue;
          }
          const binary = readFileSync(resolve(nswRoot, record.filename));
          const actualHash = createHash("sha256").update(binary).digest("hex");
          if (actualHash !== record.sha256.toLowerCase()) throw new Error("SOURCE_HASH_MISMATCH");
          const text = await extractPdfText(binary);
          importBomNswTideFile(db, { text, binary, filename: record.filename, sourceUrl: record.sourceUrl, downloadedAtUtc: record.downloadedAtUtc, stationId: record.stationId });
          importedFiles += 1;
        } catch (error) {
          errors.push(`${record.filename}:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`downloads-manifest.json:${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push("downloads-manifest.json:SEED_MANIFEST_MISSING");
  }

  const msqPath = resolve(seedRoot, "p045044a_gold-coast-seaway_2026_10min.csv");
  if (existsSync(msqPath)) {
    try {
      if (alreadyImported(db, "045044A", 2026, 4)) skippedFiles += 1;
      else {
        importMsqTideFile(db, {
          text: readFileSync(msqPath, "utf8"),
          filename: "p045044a_gold-coast-seaway_2026_10min.csv",
          sourceUrl: "https://www.data.qld.gov.au/dataset/2e32c888-ba1b-4ab4-99d0-296962f4d3e2/resource/fe33fb39-bf49-42f4-8886-ce305fcf9dbb/download/p045044a_gold-coast-seaway_2026_10min.csv",
          downloadedAtUtc: "2026-07-12T06:07:38.000Z",
        });
        importedFiles += 1;
      }
    } catch (error) {
      errors.push(`p045044a_gold-coast-seaway_2026_10min.csv:${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push("p045044a_gold-coast-seaway_2026_10min.csv:SEED_FILE_MISSING");
  }

  const stationCount = Number((db.prepare("SELECT COUNT(*) AS count FROM tide_stations").get() as { count: number }).count);
  const eventCount = Number((db.prepare("SELECT COUNT(*) AS count FROM tide_events").get() as { count: number }).count);
  return {
    status: stationCount && !errors.length ? "READY" : stationCount ? "PARTIAL" : "UNAVAILABLE",
    source: "BUNDLED_OFFICIAL_FILES",
    importedFiles,
    skippedFiles,
    failedFiles: errors.length,
    stationCount,
    eventCount,
    completedAtUtc: new Date().toISOString(),
    errors,
  };
}
