import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listings } from '@/lib/db';
import { bestCategory, cityFromAddress } from '@/lib/derive';
import { enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { fetchPlaceProfile } from '@/lib/google-places';
import { requireAuth } from '@/lib/session';

/**
 * POST /api/listings/enrich   { onlyMissing?: boolean, limit?: number }
 *
 * Pulls phone, category, address and website from Google for listings that are
 * missing them (1 API call per listing). Works in a time-boxed batch, so call
 * it again while `remaining` is above zero.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  /** false = refresh every listing, not just the ones with gaps. */
  onlyMissing: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(200),
});

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    enforceRateLimit(req, 'enrich', 6, 10 * 60_000);
    const { onlyMissing, limit } = await parseJsonBody(req, schema);

    const all = listings.all();
    const candidates = all.filter((l) => (onlyMissing ? !l.phone || !l.category || !l.address : true));
    const todo = candidates.slice(0, limit);

    let updated = 0;
    let failed = 0;
    let processed = 0;
    const deadline = Date.now() + 45_000;
    const errors: string[] = [];

    for (let i = 0; i < todo.length; i += 4) {
      if (Date.now() > deadline) break;
      const batch = todo.slice(i, i + 4);
      const results = await Promise.allSettled(batch.map((l) => fetchPlaceProfile(l.placeId, l.cid)));
      results.forEach((res, idx) => {
        const l = batch[idx];
        processed += 1;
        if (res.status === 'rejected') {
          failed += 1;
          if (errors.length < 5) errors.push(`${l.name}: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
          return;
        }
        const p = res.value;
        if (!p) {
          failed += 1;
          return;
        }
        const patch: Record<string, string> = {};
        if (!l.phone && p.phone) patch.phone = p.phone;
        if (!l.website && p.website) patch.website = p.website;
        if (!l.address && p.address) patch.address = p.address;
        if (!l.category) {
          const cat = bestCategory(p.types, l.name);
          if (cat) patch.category = cat;
        }
        if (!l.city) {
          const city = cityFromAddress(p.address ?? l.address);
          if (city) patch.city = city;
        }
        if (Object.keys(patch).length) {
          listings.update(l.id, patch);
          updated += 1;
        }
      });
    }

    return jsonOk({ candidates: candidates.length, processed, updated, failed, remaining: Math.max(0, candidates.length - processed), errors });
  } catch (err) {
    return handleRouteError(err, 'POST /api/listings/enrich');
  }
}
