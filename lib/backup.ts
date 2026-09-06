import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { closeDb, databasePath, getDb } from './db';

/**
 * SQLite backups. `createBackup()` uses the online backup API (safe while the
 * app is running). Automatic backups run once per UTC day from the cron route;
 * the newest KEEP files are kept.
 */

const KEEP = 14;

export interface BackupInfo {
  file: string;
  name: string;
  size: number;
  createdAt: string;
  kind: 'auto' | 'manual' | 'pre-restore' | 'other';
}

export function backupsDir(): string {
  const dir = resolve(dirname(databasePath()), 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:T]/g, '-').slice(0, 16);
}

export function listBackups(): BackupInfo[] {
  const dir = backupsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((name) => {
      const file = join(dir, name);
      const st = statSync(file);
      const kind: BackupInfo['kind'] = name.startsWith('auto-') ? 'auto' : name.startsWith('manual-') ? 'manual' : name.startsWith('pre-restore-') ? 'pre-restore' : 'other';
      return { file, name, size: st.size, createdAt: st.mtime.toISOString(), kind };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createBackup(kind: 'auto' | 'manual' | 'pre-restore' = 'manual'): Promise<BackupInfo> {
  const name = `${kind}-${stamp()}.sqlite`;
  const file = join(backupsDir(), name);
  await getDb().backup(file);
  const st = statSync(file);
  pruneBackups();
  return { file, name, size: st.size, createdAt: st.mtime.toISOString(), kind };
}

export function pruneBackups(keep = KEEP): number {
  const all = listBackups().filter((b) => b.kind === 'auto' || b.kind === 'manual');
  let removed = 0;
  for (const b of all.slice(keep)) {
    try {
      unlinkSync(b.file);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/** Create today's automatic backup if it does not exist yet. */
export async function dailyBackupIfDue(): Promise<BackupInfo | null> {
  const today = new Date().toISOString().slice(0, 10);
  if (listBackups().some((b) => b.kind === 'auto' && b.name.startsWith(`auto-${today}`))) return null;
  return createBackup('auto');
}

export function getBackup(name: string): BackupInfo | null {
  if (!/^[a-z-]+-[0-9-]+\.sqlite$/.test(name)) return null;
  return listBackups().find((b) => b.name === name) ?? null;
}

export function deleteBackup(name: string): boolean {
  const b = getBackup(name);
  if (!b) return false;
  unlinkSync(b.file);
  return true;
}

/** Validate an uploaded SQLite file, back up the current DB, then swap it in. */
export async function restoreFromBuffer(buf: Buffer): Promise<{ preRestore: BackupInfo; listings: number }> {
  if (buf.length < 100 || buf.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
    throw new Error('That file is not a SQLite database');
  }
  const tmp = join(backupsDir(), `upload-${stamp()}-${process.pid}.sqlite`);
  writeFileSync(tmp, buf);
  let listings = 0;
  try {
    const probe = new Database(tmp, { readonly: true });
    try {
      const tables = (probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
      if (!tables.includes('listings')) throw new Error('This database has no "listings" table — not a GMB Guard backup');
      listings = (probe.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n;
    } finally {
      probe.close();
    }
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }

  const preRestore = await createBackup('pre-restore');
  const target = databasePath();
  closeDb();
  try {
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(target + suffix)) rmSync(target + suffix, { force: true });
    }
    copyFileSync(tmp, target);
  } finally {
    rmSync(tmp, { force: true });
    getDb(); // reopen (runs migrations if the backup is older)
  }
  return { preRestore, listings };
}
