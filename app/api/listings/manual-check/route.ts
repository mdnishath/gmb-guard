import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listings } from '@/lib/db';
import { ApiError, enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { recordCheckRun, runChecks, runChecksForAllListings, summaryWithoutResults } from '@/lib/gmb-checker';

/**
 * POST /api/listings/manual-check
 *
 *   { "listingId": "…" }          → check one listing (used by "Check now")
 *   { "listingIds": ["…", …] }    → check a selection (bulk action)
 *   { "all": true }               → check every monitored listing
 *
 * Returns the run summary, and for single-listing checks the refreshed listing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const TIME_BUDGET_MS = (process.env.VERCEL ? maxDuration - 10 : 600) * 1000;

const manualCheckSchema = z
  .object({
    listingId: z.string().trim().min(1).optional(),
    listingIds: z.array(z.string().trim().min(1)).min(1).max(1000).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => [v.listingId, v.listingIds, v.all === true].filter(Boolean).length === 1, {
    message: 'Provide exactly one of: listingId, listingIds, or all: true',
  });

export async function POST(req: NextRequest) {
  try {
    const input = await parseJsonBody(req, manualCheckSchema);
    if (input.all) enforceRateLimit(req, 'check-all', 2, 5 * 60_000);
    else enforceRateLimit(req, 'check', 200, 60_000);

    // --- Single listing ------------------------------------------------------
    if (input.listingId) {
      const listing = listings.getById(input.listingId);
      if (!listing) throw new ApiError(404, 'Listing not found');

      const summary = await runChecks([listing], { concurrency: 1 });
      const refreshed = listings.getById(listing.id) ?? listing;

      return jsonOk({
        mode: 'single' as const,
        listing: listings.toPublic(refreshed),
        result: summary.results[0] ?? null,
        summary: summaryWithoutResults(summary),
      });
    }

    // --- Selection -------------------------------------------------------------
    if (input.listingIds) {
      const unique = Array.from(new Set(input.listingIds));
      const selected = listings.all({ ids: unique });
      if (selected.length === 0) throw new ApiError(404, 'None of the requested listings exist');

      const summary = await runChecks(selected, { timeBudgetMs: TIME_BUDGET_MS });
      return jsonOk({ mode: 'selection' as const, requested: unique.length, found: selected.length, ...summary });
    }

    // --- Everything ------------------------------------------------------------
    const summary = await runChecksForAllListings({ timeBudgetMs: TIME_BUDGET_MS });
    const run = recordCheckRun('MANUAL', summary);
    return jsonOk({ mode: 'all' as const, checkRunId: run?.id ?? null, ...summary });
  } catch (err) {
    return handleRouteError(err, 'POST /api/listings/manual-check');
  }
}
