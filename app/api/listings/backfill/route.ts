import type { NextRequest } from 'next/server';
import { listings } from '@/lib/db';
import { categoryFromName, cityFromAddress } from '@/lib/derive';
import { handleRouteError, jsonOk } from '@/lib/api-utils';
import { requireAuth } from '@/lib/session';

/**
 * POST /api/listings/backfill — fill missing cities from addresses for
 * listings imported before this heuristic existed. Admin only, idempotent.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    let updated = 0;
    for (const l of listings.all()) {
      const patch: { city?: string; category?: string } = {};
      if (!l.city && l.address) {
        const city = cityFromAddress(l.address);
        if (city) patch.city = city;
      }
      if (!l.category) {
        const category = categoryFromName(l.name);
        if (category) patch.category = category;
      }
      if (Object.keys(patch).length) {
        listings.update(l.id, patch);
        updated += 1;
      }
    }
    return jsonOk({ updated });
  } catch (err) {
    return handleRouteError(err, 'POST /api/listings/backfill');
  }
}
