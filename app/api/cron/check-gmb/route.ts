import type { NextRequest } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/auth';
import { handleRouteError, jsonError, jsonOk } from '@/lib/api-utils';
import { dailyBackupIfDue } from '@/lib/backup';
import { alertLogs } from '@/lib/db';
import { recordCheckRun, runChecksForAllListings, summaryWithoutResults } from '@/lib/gmb-checker';
import { flushGoogleUsage } from '@/lib/google-budget';
import { sendCheckRunSummary } from '@/lib/notifications';
import { getAppSettings } from '@/lib/settings';

/**
 * Scheduled entry point — daily at 03:00 UTC (vercel.json / crontab).
 *
 * Called with GET and `Authorization: Bearer $CRON_SECRET`.
 * POST is also exported so you can trigger it manually from a script.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vercel hard limit (Hobby = 60s). On a VPS there is no limit; the budget still keeps runs bounded. */
export const maxDuration = 60;
const TIME_BUDGET_MS = (process.env.VERCEL ? maxDuration - 10 : 600) * 1000;

async function handleCron(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return jsonError(401, 'Unauthorized');
  }

  const runId = `cron-${Date.now().toString(36)}`;
  const settings = getAppSettings();

  if (settings.monitoringPaused) {
    console.info(`[cron/check-gmb] ${runId} skipped: monitoring is paused`);
    return jsonOk({ runId, skippedRun: true, reason: 'Monitoring is paused in settings' });
  }

  console.info(`[cron/check-gmb] ${runId} started`);

  try {
    const summary = await runChecksForAllListings({ timeBudgetMs: TIME_BUDGET_MS, settings });
    const run = recordCheckRun('CRON', summary);
    flushGoogleUsage();

    // Daily automatic backup (kept for 14 days). Best-effort.
    const backup = await dailyBackupIfDue().catch((err: unknown) => {
      console.error(`[cron/check-gmb] ${runId} backup failed:`, err);
      return null;
    });

    console.info(
      `[cron/check-gmb] ${runId} finished: total=${summary.total} checked=${summary.checked} ` +
        `changed=${summary.changed} errors=${summary.errors} skipped=${summary.skipped} in ${summary.durationMs}ms`,
    );

    // Digest is best-effort and only sent when something noteworthy happened.
    const digest = await sendCheckRunSummary(summary, { settings }).catch((err: unknown) => {
      console.error(`[cron/check-gmb] ${runId} digest failed:`, err);
      return null;
    });
    for (const ch of digest?.channels ?? []) {
      if (ch.status === 'skipped') continue;
      alertLogs.create({
        listingId: null,
        channel: ch.channel,
        status: ch.status === 'sent' ? 'SENT' : 'FAILED',
        recipient: ch.recipient,
        event: 'RUN_SUMMARY',
        previousStatus: null,
        newStatus: null,
        error: ch.error,
      });
    }

    return jsonOk({ runId, checkRunId: run?.id ?? null, ...summaryWithoutResults(summary), digest, backup: backup ? backup.name : null });
  } catch (err) {
    return handleRouteError(err, `cron/check-gmb ${runId}`);
  }
}

export { handleCron as GET, handleCron as POST };
