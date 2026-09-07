import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { encrypt, tryDecrypt } from './crypto';
import { databasePath } from './db-path';

export { databasePath };

/**
 * SQLite data layer (better-sqlite3, synchronous, zero config).
 *
 * The database is a single file (DATABASE_PATH, default ./data/gmb.sqlite).
 * The schema is created on first open and is idempotent, so there is no
 * migration tool: new columns are added with `ALTER TABLE … ADD COLUMN` guarded
 * by a check in `migrate()`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const LISTING_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const ALERT_CHANNELS = ['TELEGRAM', 'EMAIL'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_STATUSES = ['SENT', 'FAILED', 'SKIPPED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const CHECK_TRIGGERS = ['CRON', 'MANUAL'] as const;
export type CheckTrigger = (typeof CHECK_TRIGGERS)[number];

export interface Listing {
  id: string;
  name: string;
  placeId: string;
  cid: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  phone: string | null;
  website: string | null;
  /** Original Google Maps link from the import — the most reliable way to re-check the listing. */
  sourceUrl: string | null;
  tag: string | null;
  notes: string | null;
  /** Google account that owns the profile (login email). */
  accountEmail: string | null;
  /** Encrypted at rest — never expose directly; use listings.getSecrets(). */
  accountPassword: string | null;
  /** Encrypted at rest — never expose directly; use listings.getSecrets(). */
  totpSecret: string | null;
  currentStatus: ListingStatus;
  monitoringEnabled: boolean;
  /** ISO timestamp of the last definitive check (null = never checked). */
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  listingId: string;
  previousStatus: ListingStatus;
  newStatus: ListingStatus;
  rawApiResponse: unknown;
  checkedAt: string;
}

export interface AlertLog {
  id: string;
  listingId: string | null;
  channel: AlertChannel;
  status: AlertStatus;
  recipient: string | null;
  event: string;
  previousStatus: ListingStatus | null;
  newStatus: ListingStatus | null;
  error: string | null;
  createdAt: string;
}

export interface CheckRun {
  id: string;
  trigger: CheckTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  checked: number;
  changed: number;
  errors: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 5;

export const USER_ROLES = ['ADMIN', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
export type PublicUser = Omit<User, 'passwordHash'>;

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
}

/** Listing as returned by the API: secrets replaced by booleans. */
export type PublicListing = Omit<Listing, 'accountPassword' | 'totpSecret'> & { hasPassword: boolean; hasTotp: boolean };

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS listings (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  placeId           TEXT NOT NULL UNIQUE,
  cid               TEXT,
  address           TEXT,
  city              TEXT,
  category          TEXT,
  phone             TEXT,
  website           TEXT,
  sourceUrl         TEXT,
  tag               TEXT,
  notes             TEXT,
  accountEmail      TEXT,
  accountPassword   TEXT,
  totpSecret        TEXT,
  currentStatus     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (currentStatus IN ('ACTIVE','SUSPENDED','CLOSED')),
  monitoringEnabled INTEGER NOT NULL DEFAULT 1,
  lastCheckedAt     TEXT,
  lastError         TEXT,
  createdAt         TEXT NOT NULL,
  updatedAt         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings(currentStatus);
CREATE INDEX IF NOT EXISTS listings_lastChecked_idx ON listings(lastCheckedAt);
CREATE INDEX IF NOT EXISTS listings_city_idx ON listings(city);
CREATE INDEX IF NOT EXISTS listings_category_idx ON listings(category);

CREATE TABLE IF NOT EXISTS audit_logs (
  id             TEXT PRIMARY KEY,
  listingId      TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  previousStatus TEXT NOT NULL,
  newStatus      TEXT NOT NULL,
  rawApiResponse TEXT NOT NULL,
  checkedAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_listing_idx ON audit_logs(listingId, checkedAt DESC);
CREATE INDEX IF NOT EXISTS audit_checkedAt_idx ON audit_logs(checkedAt DESC);
CREATE INDEX IF NOT EXISTS audit_newStatus_idx ON audit_logs(newStatus, checkedAt DESC);

CREATE TABLE IF NOT EXISTS alert_logs (
  id             TEXT PRIMARY KEY,
  listingId      TEXT REFERENCES listings(id) ON DELETE SET NULL,
  channel        TEXT NOT NULL,
  status         TEXT NOT NULL,
  recipient      TEXT,
  event          TEXT NOT NULL,
  previousStatus TEXT,
  newStatus      TEXT,
  error          TEXT,
  createdAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_createdAt_idx ON alert_logs(createdAt DESC);
CREATE INDEX IF NOT EXISTS alert_listing_idx ON alert_logs(listingId, createdAt DESC);

CREATE TABLE IF NOT EXISTS check_runs (
  id         TEXT PRIMARY KEY,
  trigger    TEXT NOT NULL,
  startedAt  TEXT NOT NULL,
  finishedAt TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  checked    INTEGER NOT NULL,
  changed    INTEGER NOT NULL,
  errors     INTEGER NOT NULL,
  skipped    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS check_runs_startedAt_idx ON check_runs(startedAt DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('ADMIN','VIEWER')),
  passwordHash TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL,
  lastLoginAt  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  userId     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt  TEXT NOT NULL,
  expiresAt  TEXT NOT NULL,
  lastSeenAt TEXT NOT NULL,
  ip         TEXT,
  userAgent  TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(userId);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expiresAt);
`;

function open(): Database.Database {
  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function migrate(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < 2) {
    addColumnIfMissing(db, 'listings', 'phone', 'TEXT');
    addColumnIfMissing(db, 'listings', 'website', 'TEXT');
  }
  if (version < 3) {
    addColumnIfMissing(db, 'listings', 'accountEmail', 'TEXT');
    addColumnIfMissing(db, 'listings', 'accountPassword', 'TEXT');
    addColumnIfMissing(db, 'listings', 'totpSecret', 'TEXT');
  }
  if (version < 5) addColumnIfMissing(db, 'listings', 'sourceUrl', 'TEXT');
  if (version < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

const globalForDb = globalThis as unknown as { __gmbDb?: Database.Database };

/** Process-wide connection (cached across Next.js HMR reloads). */
export function getDb(): Database.Database {
  if (!globalForDb.__gmbDb) globalForDb.__gmbDb = open();
  return globalForDb.__gmbDb;
}

/** Close the connection (used before restoring a backup). The next getDb() reopens it. */
export function closeDb(): void {
  try {
    globalForDb.__gmbDb?.close();
  } finally {
    globalForDb.__gmbDb = undefined;
  }
}

export class UniqueConstraintError extends Error {
  constructor(
    public readonly field: string,
    message = `A record with the same ${field} already exists`,
  ) {
    super(message);
    this.name = 'UniqueConstraintError';
  }
}

function isUniqueError(err: unknown): err is Error & { code: string } {
  return err instanceof Error && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

type ListingRow = Omit<Listing, 'monitoringEnabled'> & { monitoringEnabled: number };

function rowToListing(r: ListingRow): Listing {
  return { ...r, monitoringEnabled: r.monitoringEnabled === 1 };
}

export interface ListingCreateInput {
  name: string;
  placeId: string;
  cid?: string | null;
  address?: string | null;
  city?: string | null;
  category?: string | null;
  phone?: string | null;
  website?: string | null;
  sourceUrl?: string | null;
  tag?: string | null;
  notes?: string | null;
  accountEmail?: string | null;
  /** Plain text; encrypted before storage. */
  accountPassword?: string | null;
  /** Plain text base32; encrypted before storage. */
  totpSecret?: string | null;
}

export type ListingUpdateInput = Partial<
  Pick<
    Listing,
    'name' | 'cid' | 'address' | 'city' | 'category' | 'phone' | 'website' | 'sourceUrl' | 'tag' | 'notes' | 'accountEmail' | 'accountPassword' | 'totpSecret' | 'monitoringEnabled'
  >
>;

const SECRET_FIELDS = new Set(['accountPassword', 'totpSecret']);

function encryptSecret(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return encrypt(value);
}

export const LISTING_SORT_FIELDS = ['name', 'city', 'category', 'currentStatus', 'lastCheckedAt', 'createdAt', 'updatedAt'] as const;
export type ListingSortField = (typeof LISTING_SORT_FIELDS)[number];

export interface ListingListParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: ListingStatus;
  city?: string;
  category?: string;
  /** true = never checked (lastCheckedAt IS NULL) */
  pending?: boolean;
  /** true = the last check failed or could not confirm the status */
  hasError?: boolean;
  monitoringEnabled?: boolean;
  sortBy: ListingSortField;
  sortDir: 'asc' | 'desc';
}

function listingWhere(p: Partial<ListingListParams>): { sql: string; args: unknown[] } {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (p.status) {
    clauses.push('currentStatus = ?');
    args.push(p.status);
  }
  if (p.city) {
    clauses.push('city = ?');
    args.push(p.city);
  }
  if (p.category) {
    clauses.push('category = ?');
    args.push(p.category);
  }
  if (p.pending === true) clauses.push('lastCheckedAt IS NULL');
  if (p.pending === false) clauses.push('lastCheckedAt IS NOT NULL');
  if (p.hasError === true) clauses.push('lastError IS NOT NULL');
  if (p.hasError === false) clauses.push('lastError IS NULL');
  if (p.monitoringEnabled !== undefined) {
    clauses.push('monitoringEnabled = ?');
    args.push(p.monitoringEnabled ? 1 : 0);
  }
  if (p.search) {
    const like = `%${p.search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    clauses.push(
      "(name LIKE ? ESCAPE '\\' OR placeId LIKE ? ESCAPE '\\' OR cid LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\' OR accountEmail LIKE ? ESCAPE '\\')",
    );
    args.push(like, like, like, like, like, like, like, like, like);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args };
}

export const listings = {
  list(p: ListingListParams): { items: Listing[]; total: number } {
    const db = getDb();
    const { sql, args } = listingWhere(p);
    const sortBy = LISTING_SORT_FIELDS.includes(p.sortBy) ? p.sortBy : 'createdAt';
    const dir = p.sortDir === 'asc' ? 'ASC' : 'DESC';
    const nulls = sortBy === 'lastCheckedAt' ? `lastCheckedAt IS NULL ${dir === 'ASC' ? 'DESC' : 'ASC'}, ` : '';
    const collate = ['name', 'city', 'category'].includes(sortBy) ? ' COLLATE NOCASE' : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM listings ${sql}`).get(...args) as { n: number }).n;
    const rows = db
      .prepare(`SELECT * FROM listings ${sql} ORDER BY ${nulls}${sortBy}${collate} ${dir}, createdAt DESC LIMIT ? OFFSET ?`)
      .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as ListingRow[];
    return { items: rows.map(rowToListing), total };
  },

  all(p: { monitoringEnabled?: boolean; ids?: string[] } = {}): Listing[] {
    const db = getDb();
    if (p.ids) {
      if (p.ids.length === 0) return [];
      const marks = p.ids.map(() => '?').join(',');
      return (db.prepare(`SELECT * FROM listings WHERE id IN (${marks})`).all(...p.ids) as ListingRow[]).map(rowToListing);
    }
    const { sql, args } = listingWhere({ monitoringEnabled: p.monitoringEnabled });
    // Stalest first so time-budgeted runs pick up leftovers next time.
    return (
      db.prepare(`SELECT * FROM listings ${sql} ORDER BY lastCheckedAt IS NULL DESC, lastCheckedAt ASC, createdAt ASC`).all(...args) as ListingRow[]
    ).map(rowToListing);
  },

  getById(id: string): Listing | null {
    const row = getDb().prepare('SELECT * FROM listings WHERE id = ?').get(id) as ListingRow | undefined;
    return row ? rowToListing(row) : null;
  },

  existingPlaceIds(placeIds: string[]): Set<string> {
    if (placeIds.length === 0) return new Set();
    const db = getDb();
    const found = new Set<string>();
    for (let i = 0; i < placeIds.length; i += 500) {
      const chunk = placeIds.slice(i, i + 500);
      const rows = db.prepare(`SELECT placeId FROM listings WHERE placeId IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as {
        placeId: string;
      }[];
      rows.forEach((r) => found.add(r.placeId));
    }
    return found;
  },

  create(input: ListingCreateInput): Listing {
    const db = getDb();
    const id = randomUUID();
    const ts = nowIso();
    try {
      db.prepare(
        `INSERT INTO listings (id, name, placeId, cid, address, city, category, phone, website, sourceUrl, tag, notes, accountEmail, accountPassword, totpSecret, currentStatus, monitoringEnabled, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`,
      ).run(
        id,
        input.name,
        input.placeId,
        input.cid ?? null,
        input.address ?? null,
        input.city ?? null,
        input.category ?? null,
        input.phone ?? null,
        input.website ?? null,
        input.sourceUrl ?? null,
        input.tag ?? null,
        input.notes ?? null,
        input.accountEmail ?? null,
        encryptSecret(input.accountPassword),
        encryptSecret(input.totpSecret),
        ts,
        ts,
      );
    } catch (err) {
      if (isUniqueError(err)) throw new UniqueConstraintError('placeId');
      throw err;
    }
    return listings.getById(id)!;
  },

  /** Insert many in one transaction; rows whose placeId already exists are skipped. */
  createMany(inputs: ListingCreateInput[]): { created: Listing[]; skipped: number } {
    const db = getDb();
    const created: Listing[] = [];
    let skipped = 0;
    const run = db.transaction((rows: ListingCreateInput[]) => {
      for (const row of rows) {
        try {
          created.push(listings.create(row));
        } catch (err) {
          if (err instanceof UniqueConstraintError) skipped += 1;
          else throw err;
        }
      }
    });
    run(inputs);
    return { created, skipped };
  },

  update(id: string, patch: ListingUpdateInput): Listing | null {
    const db = getDb();
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      sets.push(`${key} = ?`);
      if (key === 'monitoringEnabled') args.push(value ? 1 : 0);
      else if (SECRET_FIELDS.has(key)) args.push(encryptSecret(value as string | null));
      else args.push(value);
    }
    if (sets.length === 0) return listings.getById(id);
    sets.push('updatedAt = ?');
    args.push(nowIso(), id);
    const info = db.prepare(`UPDATE listings SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return info.changes ? listings.getById(id) : null;
  },

  /** Replace the identifier (e.g. "cid:123" → real Place ID after the first check). */
  updatePlaceId(id: string, placeId: string): void {
    try {
      getDb().prepare('UPDATE listings SET placeId = ?, updatedAt = ? WHERE id = ?').run(placeId, nowIso(), id);
    } catch (err) {
      if (isUniqueError(err)) throw new UniqueConstraintError('placeId');
      throw err;
    }
  },

  /** Strip secrets for API responses. */
  toPublic(l: Listing): PublicListing {
    const { accountPassword, totpSecret, ...rest } = l;
    return { ...rest, hasPassword: Boolean(accountPassword), hasTotp: Boolean(totpSecret) };
  },

  /** Decrypted credentials for one listing (only for the credentials endpoint). */
  getSecrets(id: string): { accountEmail: string | null; accountPassword: string | null; totpSecret: string | null } | null {
    const l = listings.getById(id);
    if (!l) return null;
    return { accountEmail: l.accountEmail, accountPassword: tryDecrypt(l.accountPassword), totpSecret: tryDecrypt(l.totpSecret) };
  },

  remove(id: string): Listing | null {
    const existing = listings.getById(id);
    if (!existing) return null;
    getDb().prepare('DELETE FROM listings WHERE id = ?').run(id);
    return existing;
  },

  removeMany(ids: string[]): number {
    if (ids.length === 0) return 0;
    const db = getDb();
    const stmt = db.prepare('DELETE FROM listings WHERE id = ?');
    let n = 0;
    db.transaction(() => {
      for (const id of ids) n += stmt.run(id).changes;
    })();
    return n;
  },

  /** Successful check, no status change. */
  markChecked(id: string, checkedAt: Date): void {
    getDb()
      .prepare('UPDATE listings SET lastCheckedAt = ?, lastError = NULL, updatedAt = ? WHERE id = ?')
      .run(checkedAt.toISOString(), nowIso(), id);
  },

  /** Transient failure: keep status, remember the error. */
  markError(id: string, error: string): void {
    getDb().prepare('UPDATE listings SET lastError = ?, updatedAt = ? WHERE id = ?').run(error.slice(0, 500), nowIso(), id);
  },

  /** Status change + audit log, atomically. */
  applyStatusChange(input: {
    id: string;
    previousStatus: ListingStatus;
    newStatus: ListingStatus;
    rawApiResponse: unknown;
    checkedAt: Date;
  }): AuditLog {
    const db = getDb();
    const log: AuditLog = {
      id: randomUUID(),
      listingId: input.id,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      rawApiResponse: input.rawApiResponse,
      checkedAt: input.checkedAt.toISOString(),
    };
    db.transaction(() => {
      db.prepare('UPDATE listings SET currentStatus = ?, lastCheckedAt = ?, lastError = NULL, updatedAt = ? WHERE id = ?').run(
        input.newStatus,
        log.checkedAt,
        nowIso(),
        input.id,
      );
      db.prepare(
        'INSERT INTO audit_logs (id, listingId, previousStatus, newStatus, rawApiResponse, checkedAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(log.id, log.listingId, log.previousStatus, log.newStatus, JSON.stringify(log.rawApiResponse ?? null), log.checkedAt);
    })();
    return log;
  },

  count(): number {
    return (getDb().prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n;
  },

  countByStatus(): Record<ListingStatus, number> {
    const out: Record<ListingStatus, number> = { ACTIVE: 0, SUSPENDED: 0, CLOSED: 0 };
    const rows = getDb().prepare('SELECT currentStatus AS s, COUNT(*) AS n FROM listings GROUP BY currentStatus').all() as {
      s: ListingStatus;
      n: number;
    }[];
    rows.forEach((r) => (out[r.s] = r.n));
    return out;
  },

  countWhere(p: Partial<ListingListParams>): number {
    const { sql, args } = listingWhere(p);
    return (getDb().prepare(`SELECT COUNT(*) AS n FROM listings ${sql}`).get(...args) as { n: number }).n;
  },

  maxLastCheckedAt(): string | null {
    return (getDb().prepare('SELECT MAX(lastCheckedAt) AS m FROM listings').get() as { m: string | null }).m;
  },

  distinct(field: 'city' | 'category'): string[] {
    return (
      getDb().prepare(`SELECT DISTINCT ${field} AS v FROM listings WHERE ${field} IS NOT NULL AND ${field} <> '' ORDER BY v COLLATE NOCASE`).all() as {
        v: string;
      }[]
    ).map((r) => r.v);
  },

  /** Non-active listings grouped by city (for "most affected cities"). */
  affectedByCity(limit = 8): Array<{ city: string; count: number }> {
    return getDb()
      .prepare(
        `SELECT COALESCE(NULLIF(city, ''), 'Unknown') AS city, COUNT(*) AS count FROM listings WHERE currentStatus <> 'ACTIVE' GROUP BY city ORDER BY count DESC, city LIMIT ?`,
      )
      .all(limit) as Array<{ city: string; count: number }>;
  },
};

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

type AuditRow = Omit<AuditLog, 'rawApiResponse'> & { rawApiResponse: string };

function rowToAudit(r: AuditRow, includeRaw: boolean): AuditLog {
  let raw: unknown = undefined;
  if (includeRaw) {
    try {
      raw = JSON.parse(r.rawApiResponse);
    } catch {
      raw = r.rawApiResponse;
    }
  }
  return { ...r, rawApiResponse: raw };
}

export interface AuditListParams {
  listingId?: string;
  newStatus?: ListingStatus;
  since?: Date;
  page: number;
  pageSize: number;
  includeRaw: boolean;
}

export type AuditLogWithListing = AuditLog & {
  listing: { name: string; placeId: string; cid: string | null; city: string | null; currentStatus: ListingStatus } | null;
};

export const auditLogs = {
  list(p: AuditListParams): { items: AuditLogWithListing[]; total: number } {
    const db = getDb();
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (p.listingId) {
      clauses.push('a.listingId = ?');
      args.push(p.listingId);
    }
    if (p.newStatus) {
      clauses.push('a.newStatus = ?');
      args.push(p.newStatus);
    }
    if (p.since) {
      clauses.push('a.checkedAt >= ?');
      args.push(p.since.toISOString());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs a ${where}`).get(...args) as { n: number }).n;
    const rows = db
      .prepare(
        `SELECT a.*, l.name AS l_name, l.placeId AS l_placeId, l.cid AS l_cid, l.city AS l_city, l.currentStatus AS l_status
         FROM audit_logs a LEFT JOIN listings l ON l.id = a.listingId
         ${where} ORDER BY a.checkedAt DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Array<
      AuditRow & { l_name: string | null; l_placeId: string | null; l_cid: string | null; l_city: string | null; l_status: ListingStatus | null }
    >;
    const items = rows.map((r) => {
      const { l_name, l_placeId, l_cid, l_city, l_status, ...rest } = r;
      return {
        ...rowToAudit(rest, p.includeRaw),
        listing: l_name && l_placeId && l_status ? { name: l_name, placeId: l_placeId, cid: l_cid, city: l_city, currentStatus: l_status } : null,
      };
    });
    return { items, total };
  },

  forListing(listingId: string, take = 50): AuditLog[] {
    return (
      getDb().prepare('SELECT * FROM audit_logs WHERE listingId = ? ORDER BY checkedAt DESC LIMIT ?').all(listingId, take) as AuditRow[]
    ).map((r) => rowToAudit(r, false));
  },

  countSince(since: Date, filter: { newStatus?: ListingStatus; recovery?: boolean } = {}): number {
    const clauses = ['checkedAt >= ?'];
    const args: unknown[] = [since.toISOString()];
    if (filter.newStatus) {
      clauses.push('newStatus = ?');
      args.push(filter.newStatus);
    }
    if (filter.recovery) clauses.push("newStatus = 'ACTIVE' AND previousStatus <> 'ACTIVE'");
    return (getDb().prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${clauses.join(' AND ')}`).get(...args) as { n: number }).n;
  },

  /** All logs since a date (oldest first), joined with listing name/city. Used by reports. */
  since(since: Date): Array<AuditLog & { name: string; city: string | null; currentStatus: ListingStatus }> {
    const rows = getDb()
      .prepare(
        `SELECT a.id, a.listingId, a.previousStatus, a.newStatus, a.checkedAt, l.name, l.city, l.currentStatus
         FROM audit_logs a JOIN listings l ON l.id = a.listingId
         WHERE a.checkedAt >= ? ORDER BY a.listingId, a.checkedAt ASC`,
      )
      .all(since.toISOString()) as Array<Omit<AuditLog, 'rawApiResponse'> & { name: string; city: string | null; currentStatus: ListingStatus }>;
    return rows.map((r) => ({ ...r, rawApiResponse: undefined }));
  },

  recent(take = 8): AuditLogWithListing[] {
    return auditLogs.list({ page: 1, pageSize: take, includeRaw: false }).items;
  },
};

// ---------------------------------------------------------------------------
// Alert logs
// ---------------------------------------------------------------------------

export interface AlertLogListParams {
  listingId?: string;
  event?: string;
  status?: AlertStatus;
  page: number;
  pageSize: number;
}

export type AlertLogWithListing = AlertLog & { listing: { name: string; city: string | null } | null };

export const alertLogs = {
  create(input: Omit<AlertLog, 'id' | 'createdAt'>): AlertLog {
    const row: AlertLog = { ...input, id: randomUUID(), createdAt: nowIso() };
    getDb()
      .prepare(
        `INSERT INTO alert_logs (id, listingId, channel, status, recipient, event, previousStatus, newStatus, error, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.listingId, row.channel, row.status, row.recipient, row.event, row.previousStatus, row.newStatus, row.error, row.createdAt);
    return row;
  },

  list(p: AlertLogListParams): { items: AlertLogWithListing[]; total: number } {
    const db = getDb();
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (p.listingId) {
      clauses.push('a.listingId = ?');
      args.push(p.listingId);
    }
    if (p.event) {
      clauses.push('a.event = ?');
      args.push(p.event);
    }
    if (p.status) {
      clauses.push('a.status = ?');
      args.push(p.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM alert_logs a ${where}`).get(...args) as { n: number }).n;
    const rows = db
      .prepare(
        `SELECT a.*, l.name AS l_name, l.city AS l_city FROM alert_logs a LEFT JOIN listings l ON l.id = a.listingId
         ${where} ORDER BY a.createdAt DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Array<AlertLog & { l_name: string | null; l_city: string | null }>;
    return {
      items: rows.map(({ l_name, l_city, ...rest }) => ({ ...rest, listing: l_name ? { name: l_name, city: l_city } : null })),
      total,
    };
  },

  countSince(since: Date): number {
    return (getDb().prepare('SELECT COUNT(*) AS n FROM alert_logs WHERE createdAt >= ?').get(since.toISOString()) as { n: number }).n;
  },
};

// ---------------------------------------------------------------------------
// Check runs
// ---------------------------------------------------------------------------

export const checkRuns = {
  create(input: Omit<CheckRun, 'id'>): CheckRun {
    const row: CheckRun = { ...input, id: randomUUID() };
    getDb()
      .prepare(
        `INSERT INTO check_runs (id, trigger, startedAt, finishedAt, durationMs, total, checked, changed, errors, skipped)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.trigger, row.startedAt, row.finishedAt, row.durationMs, row.total, row.checked, row.changed, row.errors, row.skipped);
    return row;
  },

  latest(): CheckRun | null {
    return (getDb().prepare('SELECT * FROM check_runs ORDER BY startedAt DESC LIMIT 1').get() as CheckRun | undefined) ?? null;
  },

  list(limit = 20): CheckRun[] {
    return getDb().prepare('SELECT * FROM check_runs ORDER BY startedAt DESC LIMIT ?').all(limit) as CheckRun[];
  },
};

// ---------------------------------------------------------------------------
// Users & sessions
// ---------------------------------------------------------------------------

export const users = {
  count(): number {
    return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  },

  list(): PublicUser[] {
    return (getDb().prepare('SELECT * FROM users ORDER BY createdAt ASC').all() as User[]).map(users.toPublic);
  },

  getById(id: string): User | null {
    return (getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
  },

  findByEmail(email: string): User | null {
    return (getDb().prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim()) as User | undefined) ?? null;
  },

  create(input: { email: string; name: string; role: UserRole; passwordHash: string }): User {
    const id = randomUUID();
    const ts = nowIso();
    try {
      getDb()
        .prepare('INSERT INTO users (id, email, name, role, passwordHash, createdAt, updatedAt, lastLoginAt) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
        .run(id, input.email.trim().toLowerCase(), input.name.trim(), input.role, input.passwordHash, ts, ts);
    } catch (err) {
      if (isUniqueError(err)) throw new UniqueConstraintError('email', 'A user with this email already exists');
      throw err;
    }
    return users.getById(id)!;
  },

  update(id: string, patch: Partial<Pick<User, 'name' | 'role' | 'passwordHash' | 'lastLoginAt' | 'email'>>): User | null {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      args.push(k === 'email' ? String(v).trim().toLowerCase() : v);
    }
    if (sets.length === 0) return users.getById(id);
    sets.push('updatedAt = ?');
    args.push(nowIso(), id);
    try {
      getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    } catch (err) {
      if (isUniqueError(err)) throw new UniqueConstraintError('email', 'A user with this email already exists');
      throw err;
    }
    return users.getById(id);
  },

  remove(id: string): boolean {
    return getDb().prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
  },

  countAdmins(): number {
    return (getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'").get() as { n: number }).n;
  },

  toPublic(u: User): PublicUser {
    const { passwordHash: _ph, ...rest } = u;
    return rest;
  },
};

export const sessions = {
  create(input: { id: string; userId: string; expiresAt: Date; ip: string | null; userAgent: string | null }): Session {
    const ts = nowIso();
    const row: Session = { id: input.id, userId: input.userId, createdAt: ts, expiresAt: input.expiresAt.toISOString(), lastSeenAt: ts, ip: input.ip, userAgent: input.userAgent?.slice(0, 300) ?? null };
    getDb()
      .prepare('INSERT INTO sessions (id, userId, createdAt, expiresAt, lastSeenAt, ip, userAgent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.userId, row.createdAt, row.expiresAt, row.lastSeenAt, row.ip, row.userAgent);
    return row;
  },

  get(id: string): Session | null {
    return (getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined) ?? null;
  },

  touch(id: string): void {
    getDb().prepare('UPDATE sessions SET lastSeenAt = ? WHERE id = ?').run(nowIso(), id);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },

  removeForUser(userId: string, exceptId?: string): void {
    if (exceptId) getDb().prepare('DELETE FROM sessions WHERE userId = ? AND id <> ?').run(userId, exceptId);
    else getDb().prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
  },

  purgeExpired(): number {
    return getDb().prepare('DELETE FROM sessions WHERE expiresAt < ?').run(nowIso()).changes;
  },
};

// ---------------------------------------------------------------------------
// Settings (key → JSON)
// ---------------------------------------------------------------------------

export const settingsStore = {
  get<T = unknown>(key: string): T | null {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  },

  set(key: string, value: unknown): void {
    getDb()
      .prepare(
        'INSERT INTO app_settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt',
      )
      .run(key, JSON.stringify(value), nowIso());
  },
};
