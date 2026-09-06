import { alertLogs, auditLogs, checkRuns, listings } from '@/lib/db';
import { handleRouteError, jsonOk } from '@/lib/api-utils';
import { getAppSettings } from '@/lib/settings';

/**
 * GET /api/listings/stats
 * Dashboard numbers: status distribution, pending count, facets, last run,
 * and change counts for the last 24h / 30 days.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const total = listings.count();
    const distribution = listings.countByStatus();
    const pending = listings.countWhere({ pending: true });
    const paused = listings.countWhere({ monitoringEnabled: false });
    const withErrors = listings.countWhere({ hasError: true });
    const settings = getAppSettings();

    return jsonOk({
      total,
      distribution,
      pending,
      monitoring: { enabled: total - paused, paused, withErrors, globallyPaused: settings.monitoringPaused },
      lastCheckedAt: listings.maxLastCheckedAt(),
      lastRun: checkRuns.latest(),
      activity: {
        changesLast24h: auditLogs.countSince(dayAgo),
        suspensionsLast7d: auditLogs.countSince(weekAgo, { newStatus: 'SUSPENDED' }),
        suspensionsLast30d: auditLogs.countSince(monthAgo, { newStatus: 'SUSPENDED' }),
        recoveriesLast24h: auditLogs.countSince(dayAgo, { recovery: true }),
        recoveriesLast30d: auditLogs.countSince(monthAgo, { recovery: true }),
        alertsLast24h: alertLogs.countSince(dayAgo),
      },
      facets: { cities: listings.distinct('city'), categories: listings.distinct('category') },
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/listings/stats');
  }
}
