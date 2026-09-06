import type { NextRequest } from 'next/server';
import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { config, getEnv } from '@/lib/env';
import { googleUsageToday } from '@/lib/google-budget';
import { emailConfig, telegramConfig } from '@/lib/notifications';
import { appSettingsSchema, getAppSettings, isGoogleApiDisabled, updateAppSettings } from '@/lib/settings';
import { requireAuth } from '@/lib/session';

/**
 * GET  /api/settings   → preferences + which integrations are configured
 * PATCH /api/settings  → update preferences (partial)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mask(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-3)}`;
}

function buildResponse() {
  const settings = getAppSettings();
  const telegram = telegramConfig();
  const email = emailConfig(settings.extraEmailRecipients);
  return {
    settings,
    channels: {
      telegram: { configured: telegram.configured, chatId: mask(telegram.chatId) },
      email: {
        configured: email.configured,
        from: email.from,
        envRecipients: email.envRecipients,
        extraRecipients: settings.extraEmailRecipients,
        allRecipients: email.recipients,
      },
    },
    google: {
      configured: Boolean(getEnv('GOOGLE_PLACES_API_KEY')),
      disabled: isGoogleApiDisabled(),
      disabledByEnv: ['1', 'true', 'yes'].includes((getEnv('GOOGLE_API_DISABLED') ?? '').toLowerCase()),
    },
    cron: { configured: Boolean(getEnv('CRON_SECRET')), schedule: config.cronSchedule, timezone: 'UTC' },
    tuning: { concurrency: config.checkConcurrency, batchDelayMs: config.batchDelayMs, timeoutMs: config.googleTimeoutMs },
    usage: googleUsageToday(),
    limits: { apiPerMinute: 600, loginPer10Min: 10, resolvePerMinute: 20, importPer10Min: 10, checkAllPer5Min: 2 },
    appUrl: config.appUrl ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return jsonOk(buildResponse());
  } catch (err) {
    return handleRouteError(err, 'GET /api/settings');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    const patch = await parseJsonBody(req, appSettingsSchema.partial());
    updateAppSettings(patch);
    return jsonOk(buildResponse());
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/settings');
  }
}
