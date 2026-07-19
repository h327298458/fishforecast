import type Database from "better-sqlite3";

export type TideImportCheckState = {
  status: "PARTIAL";
  lastCheckedAtUtc: string | null;
  currentYear: number;
  nextYear: number;
  nswYearsPresent: number[];
  nextYearAvailable: boolean;
  actionRequired: boolean;
  detail: string;
};

let state: TideImportCheckState = {
  status: "PARTIAL",
  lastCheckedAtUtc: null,
  currentYear: new Date().getUTCFullYear(),
  nextYear: new Date().getUTCFullYear() + 1,
  nswYearsPresent: [],
  nextYearAvailable: false,
  actionRequired: true,
  detail: "The checker has not run yet.",
};

export function checkOfficialTideYears(db: Database.Database, now = new Date()) {
  const currentYear = now.getUTCFullYear();
  const nextYear = currentYear + 1;
  const rows = db.prepare("SELECT DISTINCT source_year AS year FROM tide_imports WHERE state='NSW' AND parse_status='VALID' ORDER BY source_year").all() as Array<{ year: number }>;
  const years = rows.map((row) => Number(row.year));
  const nextYearAvailable = years.includes(nextYear);
  state = {
    status: "PARTIAL",
    lastCheckedAtUtc: now.toISOString(),
    currentYear,
    nextYear,
    nswYearsPresent: years,
    nextYearAvailable,
    actionRequired: !nextYearAvailable,
    detail: nextYearAvailable ? `NSW ${nextYear} official tide data is already imported.` : `NSW ${nextYear} data is not imported; run the verified official-file importer when the annual file becomes available. Automatic downloading is intentionally not claimed.`,
  };
  return state;
}

export function startOfficialTideYearChecker(db: Database.Database) {
  checkOfficialTideYears(db);
  const timer = setInterval(() => checkOfficialTideYears(db), 24 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}

export const officialTideYearCheckState = () => state;
