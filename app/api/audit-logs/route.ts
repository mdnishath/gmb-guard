import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { auditLogs, LISTING_STATUSES } from '@/lib/db';
import { handleRouteError, jsonOk, pagination, parseSearchParams } from '@/lib/api-utils';

/**
 * GET /api/audit-logs?listingId=&newStatus=&since=2026-08-01&page=1&pageSize=25&includeRaw=false
 * Feeds the "Recent status changes" panel and the per-listing history tab.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  listingId: z.string().trim().min(1).optional(),
  newStatus: z.enum(LISTING_STATUSES).optional(),
  since: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeRaw: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
});

export async function GET(req: NextRequest) {
  try {
    const query = parseSearchParams(req.nextUrl.searchParams, querySchema);
    const { items, total } = auditLogs.list(query);
    return jsonOk({ items, pagination: pagination(query.page, query.pageSize, total) });
  } catch (err) {
    return handleRouteError(err, 'GET /api/audit-logs');
  }
}
