import type { NextRequest } from 'next/server';
import { listings } from '@/lib/db';
import { handleRouteError, jsonOk } from '@/lib/api-utils';
import { requireAuth } from '@/lib/session';

/**
 * GET /api/listings/duplicates
 * Listings that share a phone number — usually the same business imported
 * twice, or a shared line worth reviewing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const groups = listings.duplicatePhones();
    return jsonOk({ groups, totalGroups: groups.length, totalListings: groups.reduce((n, g) => n + g.count, 0) });
  } catch (err) {
    return handleRouteError(err, 'GET /api/listings/duplicates');
  }
}
