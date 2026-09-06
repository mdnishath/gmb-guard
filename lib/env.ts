/**
 * Centralised, lazily-evaluated environment access.
 *
 * Reads happen at call time (not module load) so `next build` does not fail when
 * secrets are only present at runtime on Vercel. Required variables throw a
 * descriptive error the first time they are actually needed.
 */

export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Add it to .env.local or your Vercel project settings.`,
    );
  }
  return value;
}

export function getEnvInt(name: string, fallback: number): number {
  const raw = getEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    console.warn(`[env] ${name}="${raw}" is not an integer, using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Tunables with safe defaults. All optional. */
export const config = {
  /** How many Google Places requests run in parallel per batch. */
  get checkConcurrency(): number {
    return clamp(getEnvInt('GMB_CHECK_CONCURRENCY', 10), 1, 50);
  },
  /** Pause between batches (ms) — raise this if Google returns OVER_QUERY_LIMIT. */
  get batchDelayMs(): number {
    return clamp(getEnvInt('GMB_BATCH_DELAY_MS', 0), 0, 10_000);
  },
  /** Per-request timeout for the Google Places API (ms). */
  get googleTimeoutMs(): number {
    return clamp(getEnvInt('GOOGLE_PLACES_TIMEOUT_MS', 8_000), 1_000, 30_000);
  },
  /** Cron expression the scheduler uses (informational; the real trigger is Vercel Cron / crontab). */
  get cronSchedule(): string {
    return getEnv('CRON_SCHEDULE') ?? '0 3 * * *';
  },
  /** Public URL of the dashboard, used for deep links inside alerts. */
  get appUrl(): string | undefined {
    return getEnv('APP_URL') ?? (getEnv('VERCEL_URL') ? `https://${getEnv('VERCEL_URL')}` : undefined);
  },
};
