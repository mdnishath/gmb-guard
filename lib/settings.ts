import { z } from 'zod';
import { settingsStore } from './db';

/**
 * App-level settings stored in the app_settings table (single JSON row under
 * key "app"). Merged with defaults so new keys never break old rows.
 */

export const appSettingsSchema = z.object({
  /** Alert when a listing goes ACTIVE → SUSPENDED (not found / removed). */
  alertOnSuspended: z.boolean(),
  /** Alert when a listing goes → CLOSED. */
  alertOnClosed: z.boolean(),
  /** Alert when a listing comes back → ACTIVE. */
  alertOnRecovered: z.boolean(),
  /** Send a digest after each cron run when something happened. */
  digestEnabled: z.boolean(),
  /** Extra email recipients in addition to ALERT_EMAIL_TO. */
  extraEmailRecipients: z.array(z.string().trim().email()).max(20),
  /** When true the cron skips all checks (manual checks still work). */
  monitoringPaused: z.boolean(),
  /** Kill switch: no Google Places API call is made anywhere while true. */
  googleApiDisabled: z.boolean(),
  /**
   * How status checks are performed:
   *  api            – Places API (precise, 1 call per listing)
   *  free           – public Maps page only (no API, best-effort)
   *  free-then-api  – Maps page first, API only when the page is inconclusive
   */
  checkMode: z.enum(['api', 'free', 'free-then-api']),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  alertOnSuspended: true,
  alertOnClosed: true,
  alertOnRecovered: true,
  digestEnabled: true,
  extraEmailRecipients: [],
  monitoringPaused: false,
  googleApiDisabled: false,
  checkMode: 'api',
};

export type CheckMode = AppSettings['checkMode'];

/** Effective check mode: the kill switch forces the free path. */
export function effectiveCheckMode(settings: AppSettings = getAppSettings()): CheckMode {
  return isGoogleApiDisabled() ? 'free' : settings.checkMode;
}

/** True when the env kill switch OR the setting disables the Google API. */
export function isGoogleApiDisabled(): boolean {
  const env = (process.env.GOOGLE_API_DISABLED ?? '').trim().toLowerCase();
  if (env === '1' || env === 'true' || env === 'yes') return true;
  return getAppSettings().googleApiDisabled;
}

const SETTINGS_KEY = 'app';

function merge(raw: unknown): AppSettings {
  const parsed = appSettingsSchema.partial().safeParse(raw ?? {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export function getAppSettings(): AppSettings {
  try {
    return merge(settingsStore.get(SETTINGS_KEY));
  } catch (err) {
    console.error('[settings] failed to load, using defaults:', err instanceof Error ? err.message : err);
    return DEFAULT_SETTINGS;
  }
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...getAppSettings(), ...patch };
  settingsStore.set(SETTINGS_KEY, next);
  return next;
}
