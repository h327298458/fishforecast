import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { applyMigrations } from '../server/db/applyMigrations.js';
import { importMsqTideFile } from '../server/providers/bomOfficialTide.js';

const defaultUrl = 'https://www.data.qld.gov.au/dataset/2e32c888-ba1b-4ab4-99d0-296962f4d3e2/resource/fe33fb39-bf49-42f4-8886-ce305fcf9dbb/download/p045044a_gold-coast-seaway_2026_10min.csv';
const source = process.argv[2] ?? defaultUrl;
const rawDir = resolve(process.env.TIDE_RAW_PATH ?? './data/raw/tides');
mkdirSync(rawDir, { recursive: true });
let text: string;
let filename: string;
if (/^https:\/\//.test(source)) {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`TIDE_DOWNLOAD_${response.status}`);
  text = await response.text();
  filename = basename(new URL(source).pathname);
  writeFileSync(resolve(rawDir, filename), text, 'utf8');
} else {
  text = readFileSync(resolve(source), 'utf8');
  filename = basename(source);
}
const dbPath = process.env.DATABASE_PATH ?? './data/tideline.db';
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
applyMigrations(db);
try {
  console.log(JSON.stringify(importMsqTideFile(db, { text, filename, sourceUrl: /^https:/.test(source) ? source : `file:${resolve(source)}`, downloadedAtUtc: new Date().toISOString() }), null, 2));
} finally { db.close(); }
