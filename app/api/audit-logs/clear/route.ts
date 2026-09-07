import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { auditLogs } from '@/lib/db';
import { enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { requireAuth } from '@/lib/session';

/**
 * POST /api/audit-logs/clear   { listingId?, before? }   (admin)
 *
 * Removes status-change history. Useful after a misconfiguration produced
 * status changes that never really happened; the Reports page counts these
 * rows, so clearing them resets the suspension chart.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  listingId: z.string().trim().min(1).optional(),
  /** Only delete rows older than this (ISO date). Omit to clear everything. */
  before: z.coerce.date().optional(),
});

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    enforceRateLimit(req, 'clear-history', 5, 10 * 60_000);
    const { listingId, before } = await parseJsonBody(req, schema);
    const deleted = auditLogs.clear({ listingId, before });
    return jsonOk({ deleted });
  } catch (err) {
    return handleRouteError(err, 'POST /api/audit-logs/clear');
  }
}
