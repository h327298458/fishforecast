import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function applyMigrations(db: Database.Database) {
  for (const file of ['001_initial.sql', '002_environment_data.sql', '003_canonical_tide_sources.sql', '004_authentication.sql']) {
    db.exec(readFileSync(resolve('server/db/migrations', file), 'utf8'));
  }
  const columns = db.prepare('PRAGMA table_info(spots)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'address')) db.exec('ALTER TABLE spots ADD COLUMN address TEXT');
  const logColumns = db.prepare('PRAGMA table_info(fishing_logs)').all() as Array<{ name: string }>;
  if (!logColumns.some((column) => column.name === 'details_json')) db.exec("ALTER TABLE fishing_logs ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'");
  if (!logColumns.some((column) => column.name === 'comparison_json')) db.exec("ALTER TABLE fishing_logs ADD COLUMN comparison_json TEXT");
  if (!columns.some((column) => column.name === 'owner_user_id')) {
    db.exec('ALTER TABLE spots ADD COLUMN owner_user_id TEXT REFERENCES users(id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_spots_owner ON spots(owner_user_id, created_at_utc)');
  }
}
