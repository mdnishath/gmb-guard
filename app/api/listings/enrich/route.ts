import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listings, type Listing } from '@/lib/db';
import { bestCategory, cityFromAddress } from '@/lib/derive';
import { enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { fetchPlaceProfile, type PlaceProfile } from '@/lib/google-places';
import { ENRICH_FIELDS, type EnrichField } from '@/lib/enrich-fields';
import { requireAuth } from '@/lib/session';

/**
 * POST /api/listings/enrich
 *
 * Reads each listing's real Google profile and copies the chosen fields into
 * our database. One Google API call per listing.
 *
 *   fields   which columns to write (phone, category, address, city, website, name)
 *   mode     'missing'   only fill empty columns   (safe)
 *            'overwrite' replace whatever we have  (fixes bad spreadsheet data)
 *   scope    'all' | 'selected' | 'missing-any'
 *
 * Time-boxed: call again while `remaining > 0`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  fields: z.array(z.enum(ENRICH_FIELDS)).min(1).default(['phone', 'category', 'address', 'city']),
  mode: z.enum(['missing', 'overwrite']).default('missing'),
  scope: z.enum(['all', 'selected', 'missing-any']).default('missing-any'),
  listingIds: z.array(z.string().trim().min(1)).max(5000).optional(),
  limit: z.number().int().min(1).max(500).default(150),
  /** Continue from this listing id (returned as `nextCursor`). */
  cursor: z.string().optional(),
});

/** What Google gave us for one field, or null when it has nothing. */
function valueFor(field: EnrichField, p: PlaceProfile, l: Listing): string | null {
  switch (field) {
    case 'phone':
      return p.phone;
    case 'website':
      return p.website;
    case 'address':
      return p.address;
    case 'name':
      return p.name;
    case 'city':
      return cityFromAddress(p.address ?? l.address);
    case 'category':
      return bestCategory(p.types, p.name ?? l.name);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    enforceRateLimit(req, 'enrich', 30, 10 * 60_000);
    const { fields, mode, scope, listingIds, limit, cursor } = await parseJsonBody(req, schema);

    let pool: Listing[];
    if (scope === 'selected') pool = listings.all({ ids: listingIds ?? [] });
    else pool = listings.all();

    if (scope === 'missing-any') {
      pool = pool.filter((l) => fields.some((f) => !l[f === 'city' ? 'city' : (f as keyof Listing)]));
    }
    pool.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (cursor) pool = pool.filter((l) => l.id > cursor);

    const todo = pool.slice(0, limit);
    const deadline = Date.now() + 45_000;

    let processed = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const perField: Record<string, number> = {};
    const errors: string[] = [];
    const samples: Array<{ name: string; changes: Record<string, { from: string | null; to: string }> }> = [];
    let lastId = cursor ?? '';

    for (let i = 0; i < todo.length; i += 4) {
      if (Date.now() > deadline) break;
      const batch = todo.slice(i, i + 4);
      const results = await Promise.allSettled(batch.map((l) => fetchPlaceProfile(l.placeId, l.cid)));

      results.forEach((res, idx) => {
        const l = batch[idx];
        processed += 1;
        lastId = l.id;

        if (res.status === 'rejected' || !res.value) {
          failed += 1;
          const msg = res.status === 'rejected' ? (res.reason instanceof Error ? res.reason.message : String(res.reason)) : 'Google returned no profile';
          if (errors.length < 8) errors.push(`${l.name}: ${msg}`);
          return;
        }

        const patch: Record<string, string> = {};
        const changes: Record<string, { from: string | null; to: string }> = {};
        for (const f of fields) {
          const current = (l[f as keyof Listing] as string | null) ?? null;
          if (mode === 'missing' && current) continue;
          const next = valueFor(f, res.value, l);
          if (!next || next === current) continue;
          patch[f] = next;
          changes[f] = { from: current, to: next };
          perField[f] = (perField[f] ?? 0) + 1;
        }

        if (Object.keys(patch).length === 0) {
          unchanged += 1;
          return;
        }
        listings.update(l.id, patch);
        updated += 1;
        if (samples.length < 10) samples.push({ name: l.name, changes });
      });
    }

    return jsonOk({
      candidates: pool.length,
      processed,
      updated,
      unchanged,
      failed,
      perField,
      remaining: Math.max(0, pool.length - processed),
      nextCursor: processed > 0 ? lastId : null,
      samples,
      errors,
    });
  } catch (err) {
    return handleRouteError(err, 'POST /api/listings/enrich');
  }
}
