import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyMigrations } from './applyMigrations.js';

const path = process.env.DATABASE_PATH ?? './data/tideline.db';
mkdirSync(dirname(path), { recursive: true });
const db = new Database(path);
applyMigrations(db);
db.close();
console.log(`migrated ${path}`);
