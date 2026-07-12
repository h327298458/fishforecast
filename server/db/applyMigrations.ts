import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function applyMigrations(db: Database.Database) {
  for (const file of ['001_initial.sql', '002_environment_data.sql']) {
    db.exec(readFileSync(resolve('server/db/migrations', file), 'utf8'));
  }
  const columns = db.prepare('PRAGMA table_info(spots)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'address')) db.exec('ALTER TABLE spots ADD COLUMN address TEXT');
}
