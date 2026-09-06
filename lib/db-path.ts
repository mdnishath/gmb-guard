import { resolve } from 'node:path';

/** Absolute path of the SQLite file (DATABASE_PATH, default ./data/gmb.sqlite). */
export function databasePath(): string {
  const raw = process.env.DATABASE_PATH?.trim() || './data/gmb.sqlite';
  return resolve(process.cwd(), raw);
}
