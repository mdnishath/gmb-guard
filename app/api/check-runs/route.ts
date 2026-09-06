import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { checkRuns } from '@/lib/db';
import { handleRouteError, jsonOk, parseJsonBody, parseSearchParams } from '@/lib/api-utils';
import { requireAuth } from '@/lib/session';

/**
 * GET  /api/check-runs?limit=10 — history of cron / manual "check all" runs.
 * POST /api/check-runs          — record a browser-driven run (the UI checks in batches).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });

export async function GET(req: NextRequest) {
  try {
    const { limit } = parseSearchParams(req.nextUrl.searchParams, querySchema);
    return jsonOk({ items: checkRuns.list(limit) });
  } catch (err) {
    return handleRouteError(err, 'GET /api/check-runs');
  }
}

const bodySchema = z.object({
  trigger: z.literal('MANUAL').default('MANUAL'),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().int().min(0),
  total: z.number().int().min(0),
  checked: z.number().int().min(0),
  changed: z.number().int().min(0),
  errors: z.number().int().min(0),
  skipped: z.number().int().min(0),
});

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await parseJsonBody(req, bodySchema);
    return jsonOk({ run: checkRuns.create(body) }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, 'POST /api/check-runs');
  }
}
