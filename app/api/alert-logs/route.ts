import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ALERT_STATUSES, alertLogs } from '@/lib/db';
import { handleRouteError, jsonOk, pagination, parseSearchParams } from '@/lib/api-utils';

/**
 * GET /api/alert-logs?event=SUSPENDED&status=FAILED&listingId=&page=1&pageSize=25
 * Every alert delivery attempt (per channel).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  listingId: z.string().trim().min(1).optional(),
  event: z.string().trim().max(40).optional(),
  status: z.enum(ALERT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(req: NextRequest) {
  try {
    const query = parseSearchParams(req.nextUrl.searchParams, querySchema);
    const { items, total } = alertLogs.list(query);
    return jsonOk({ items, pagination: pagination(query.page, query.pageSize, total) });
  } catch (err) {
    return handleRouteError(err, 'GET /api/alert-logs');
  }
}
