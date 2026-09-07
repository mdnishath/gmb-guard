import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { auditLogs, listings, type ListingStatus } from '@/lib/db';
import { handleRouteError, jsonOk, parseSearchParams } from '@/lib/api-utils';

/**
 * GET /api/reports?days=30   or   ?from=2026-08-01&to=2026-08-31
 *
 * Everything the Reports page needs, derived from the audit log:
 *  - drops per day (suspended/closed events)
 *  - every suspension event with duration + recovery
 *  - status distribution, most affected cities, lowest uptime
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function humanDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function GET(req: NextRequest) {
  try {
    const q = parseSearchParams(req.nextUrl.searchParams, querySchema);
    const now = new Date();
    const to = q.to ?? now;
    const from = q.from ?? new Date(to.getTime() - (q.days ?? 30) * DAY_MS);
    const rangeMs = Math.max(DAY_MS, to.getTime() - from.getTime());

    const logs = auditLogs.since(from).filter((l) => new Date(l.checkedAt) <= to);

    // --- Drops per day -------------------------------------------------------
    const seriesMap = new Map<string, number>();
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) seriesMap.set(dayKey(new Date(t)), 0);
    seriesMap.set(dayKey(to), seriesMap.get(dayKey(to)) ?? 0);
    // (filled in below, once short-lived flaps are known)
    const buildSeries = (items: typeof events) => {
      const m = new Map(seriesMap);
      for (const e of items) {
        const k = dayKey(new Date(e.suspendedAt));
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return Array.from(m.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, count]) => ({ date, count }));
    };

    // --- Suspension events with recovery -------------------------------------
    const byListing = new Map<string, typeof logs>();
    for (const l of logs) {
      const arr = byListing.get(l.listingId) ?? [];
      arr.push(l);
      byListing.set(l.listingId, arr);
    }

    const events: Array<{
      id: string;
      listingId: string;
      name: string;
      city: string | null;
      status: ListingStatus;
      suspendedAt: string;
      recoveredAt: string | null;
      durationMs: number;
      duration: string;
      currentStatus: ListingStatus;
    }> = [];

    const uptime = new Map<
      string,
      { listingId: string; name: string; city: string | null; downMs: number; incidents: number; currentStatus: ListingStatus }
    >();

    for (const [listingId, arr] of byListing) {
      // arr is oldest → newest
      let state: ListingStatus = arr[0].previousStatus;
      let cursor = from.getTime();
      const meta = { listingId, name: arr[0].name, city: arr[0].city, downMs: 0, incidents: 0, currentStatus: arr[0].currentStatus };

      for (let i = 0; i < arr.length; i++) {
        const l = arr[i];
        const t = new Date(l.checkedAt).getTime();
        if (state !== 'ACTIVE') meta.downMs += Math.max(0, t - cursor);
        if (l.newStatus !== 'ACTIVE' && state === 'ACTIVE') {
          meta.incidents += 1;
          const recovery = arr.slice(i + 1).find((n) => n.newStatus === 'ACTIVE');
          const recoveredAt = recovery ? new Date(recovery.checkedAt).getTime() : null;
          const durationMs = (recoveredAt ?? now.getTime()) - t;
          events.push({
            id: l.id,
            listingId,
            name: l.name,
            city: l.city,
            status: l.newStatus,
            suspendedAt: l.checkedAt,
            recoveredAt: recovery ? recovery.checkedAt : null,
            durationMs,
            duration: humanDuration(durationMs),
            currentStatus: l.currentStatus,
          });
        }
        state = l.newStatus;
        cursor = t;
      }
      if (state !== 'ACTIVE') meta.downMs += Math.max(0, to.getTime() - cursor);
      uptime.set(listingId, meta);
    }

    // Listings that have been down the whole window (no events inside it).
    for (const l of listings.list({ page: 1, pageSize: 1000, sortBy: 'name', sortDir: 'asc' }).items) {
      if (l.currentStatus !== 'ACTIVE' && !uptime.has(l.id)) {
        uptime.set(l.id, { listingId: l.id, name: l.name, city: l.city, downMs: rangeMs, incidents: 0, currentStatus: l.currentStatus });
      }
    }

    events.sort((a, b) => (a.suspendedAt < b.suspendedAt ? 1 : -1));

    // A "suspension" that recovered within a few minutes is almost always a
    // failed check rather than a real drop; keep it out of the headline numbers.
    const FLAP_MS = 30 * 60 * 1000;
    const flapping = events.filter((e) => e.recoveredAt !== null && e.durationMs < FLAP_MS);
    const realEvents = events.filter((e) => !(e.recoveredAt !== null && e.durationMs < FLAP_MS));

    const lowestUptime = Array.from(uptime.values())
      .map((u) => ({ ...u, uptimePct: Math.max(0, Math.min(100, 100 - (u.downMs / rangeMs) * 100)) }))
      .sort((a, b) => a.uptimePct - b.uptimePct)
      .slice(0, 8);

    const series = buildSeries(realEvents);

    return jsonOk({
      range: { from: from.toISOString(), to: to.toISOString(), days: Math.round(rangeMs / DAY_MS) },
      series,
      dropsToday: series.length ? series[series.length - 1].count : 0,
      totalDrops: realEvents.length,
      /** Short-lived changes excluded from the numbers above (failed checks, tests). */
      flapping: flapping.length,
      currentlySuspended: listings.countWhere({ status: 'SUSPENDED' }) + listings.countWhere({ status: 'CLOSED' }),
      events: realEvents.slice(0, 200),
      distribution: listings.countByStatus(),
      total: listings.count(),
      cities: listings.affectedByCity(8),
      lowestUptime,
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/reports');
  }
}
