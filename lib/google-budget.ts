import { settingsStore } from './db';
import { getEnvInt } from './env';
import { isGoogleApiDisabled } from './settings';

export class GoogleApiDisabledError extends Error {
  constructor() {
    super('Google API is disabled (kill switch in Settings → Google API, or GOOGLE_API_DISABLED=1). No request was sent.');
    this.name = 'GoogleApiDisabledError';
  }
}

/**
 * Daily cap on Google Places calls so a bug, a runaway import or an abusive
 * client can never produce a surprise bill. Counted per UTC day and persisted
 * in the app_settings table (survives restarts).
 *
 *   GOOGLE_DAILY_CALL_LIMIT=10000   (default)
 */

export class GoogleBudgetExceededError extends Error {
  constructor(public readonly usage: GoogleUsage) {
    super(`Daily Google Places budget reached (${usage.count}/${usage.limit} calls today). Checks resume tomorrow (UTC) or raise GOOGLE_DAILY_CALL_LIMIT.`);
    this.name = 'GoogleBudgetExceededError';
  }
}

export interface GoogleUsage {
  day: string;
  count: number;
  limit: number;
  byKind: Record<string, number>;
}

let mem: { day: string; count: number; byKind: Record<string, number> } | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function key(day: string): string {
  return `google.usage.${day}`;
}

function load(day: string): { day: string; count: number; byKind: Record<string, number> } {
  if (mem && mem.day === day) return mem;
  const stored = settingsStore.get<{ count?: number; byKind?: Record<string, number> }>(key(day));
  mem = { day, count: stored?.count ?? 0, byKind: stored?.byKind ?? {} };
  return mem;
}

export function dailyLimit(): number {
  return Math.max(0, getEnvInt('GOOGLE_DAILY_CALL_LIMIT', 10_000));
}

export function googleUsageToday(): GoogleUsage {
  const u = load(today());
  return { day: u.day, count: u.count, limit: dailyLimit(), byKind: { ...u.byKind } };
}

/** Reserve one Google call. Throws when today's budget is exhausted. */
export function chargeGoogleCall(kind: string): void {
  if (isGoogleApiDisabled()) throw new GoogleApiDisabledError();
  const limit = dailyLimit();
  const u = load(today());
  if (limit > 0 && u.count >= limit) throw new GoogleBudgetExceededError(googleUsageToday());
  u.count += 1;
  u.byKind[kind] = (u.byKind[kind] ?? 0) + 1;
  // Persist every 5 calls (and always near the limit) to keep writes cheap.
  if (u.count % 5 === 0 || u.count >= limit - 5) {
    try {
      settingsStore.set(key(u.day), { count: u.count, byKind: u.byKind });
    } catch (err) {
      console.error('[google-budget] persist failed:', err instanceof Error ? err.message : err);
    }
  }
}

/** Flush the in-memory counter (called at the end of a run). */
export function flushGoogleUsage(): void {
  if (!mem) return;
  try {
    settingsStore.set(key(mem.day), { count: mem.count, byKind: mem.byKind });
  } catch {
    /* ignore */
  }
}
