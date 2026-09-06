import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listings, type ListingCreateInput } from '@/lib/db';
import { enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { runChecks, summaryWithoutResults } from '@/lib/gmb-checker';
import { categoryFromName, cityFromAddress } from '@/lib/derive';
import { listingFieldsSchema } from '@/lib/listing-schema';

/**
 * POST /api/listings/import
 *   { rows: [{ name, placeId, cid?, address?, city?, category?, tag? }, …], checkImmediately?: boolean }
 *
 * Validates every row, skips duplicates (inside the file and against the DB),
 * inserts the rest in one transaction and optionally runs the first check.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const TIME_BUDGET_MS = (process.env.VERCEL ? maxDuration - 15 : 600) * 1000;

const importSchema = z.object({
  rows: z.array(z.unknown()).min(1).max(5000),
  checkImmediately: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  try {
    enforceRateLimit(req, 'import', 10, 10 * 60_000);
    const { rows, checkImmediately } = await parseJsonBody(req, importSchema);

    const valid: ListingCreateInput[] = [];
    const invalid: Array<{ row: number; errors: string[] }> = [];
    const seen = new Set<string>();
    let duplicatesInFile = 0;

    rows.forEach((raw, i) => {
      const parsed = listingFieldsSchema.safeParse(raw);
      if (!parsed.success) {
        invalid.push({
          row: i + 1,
          errors: parsed.error.issues.map((iss) => `${iss.path.join('.') || 'row'}: ${iss.message}`),
        });
        return;
      }
      if (seen.has(parsed.data.placeId)) {
        duplicatesInFile += 1;
        return;
      }
      seen.add(parsed.data.placeId);
      const row = parsed.data;
      if (!row.city) row.city = cityFromAddress(row.address) ?? undefined;
      if (!row.category) row.category = categoryFromName(row.name) ?? undefined;
      valid.push(row);
    });

    const existing = listings.existingPlaceIds(valid.map((v) => v.placeId));
    const fresh = valid.filter((v) => !existing.has(v.placeId));
    const duplicatesInDb = valid.length - fresh.length;

    const { created, skipped } = listings.createMany(fresh);

    let check = null;
    if (checkImmediately && created.length > 0) {
      const summary = await runChecks(created, { timeBudgetMs: TIME_BUDGET_MS });
      check = summaryWithoutResults(summary);
    }

    return jsonOk(
      {
        received: rows.length,
        imported: created.length,
        duplicates: duplicatesInFile + duplicatesInDb + skipped,
        invalid,
        check,
        listings: created.map(listings.toPublic),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err, 'POST /api/listings/import');
  }
}
