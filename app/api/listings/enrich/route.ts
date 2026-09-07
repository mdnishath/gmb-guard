import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listings } from '@/lib/db';
import { bestCategory, cityFromAddress } from '@/lib/derive';
import { enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { fetchPlaceProfile } from '@/lib/google-places';
import { requireAuth } from '@/lib/session';

/**
 * POST /api/listings/enrich
 *   { fields?: ('phone'|'city'|'address'|'category'|'website')[],
 *     overwrite?: boolean, onlyMissing?: boolean, limit?: number }
 *
 * Pulls the real phone / city / address / category / website from Google (1 API
 * call per listing) and writes them to the DB. `fields` chooses what to pull;
 * `overwrite: true` replaces existing values (e.g. wrong phone numbers imported
 * by hand), otherwise only empty fields are filled. Time-boxed, so call it again
 * while `remaining` is above zero.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FIELDS = ['phone', 'city', 'address', 'category', 'website'] as const;
type Field = (typeof FIELDS)[number];

const schema = z.object({
  /** Which fields to pull. Defaults to all of them. */
  fields: z.array(z.enum(FIELDS)).min(1).default([...FIELDS]),
  /** true = replace existing values, not only fill gaps. */
  overwrite: z.boolean().optional(),
  /** Back-compat: onlyMissing:false is the same as overwrite:true. */
  onlyMissing: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    // Overwriting the whole book takes many rounds, so allow a generous burst.
    enforceRateLimit(req, 'enrich', 60, 10 * 60_000);
    const body = await parseJsonBody(req, schema);
    const { fields, limit } = body;
    const overwrite = body.overwrite ?? body.onlyMissing === false;
    const wants = new Set<Field>(fields);

    const all = listings.all();
    // When filling gaps, a listing is a candidate only if one of the chosen
    // fields is still empty; when overwriting, every listing is refreshed.
    const isMissing = (l: (typeof all)[number]) =>
      (wants.has('phone') && !l.phone) ||
      (wants.has('website') && !l.website) ||
      (wants.has('address') && !l.address) ||
      (wants.has('category') && !l.category) ||
      (wants.has('city') && !l.city);
    const candidates = overwrite ? all : all.filter(isMissing);
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
        // Only write a field the caller asked for, that Google actually returned,
        // and (unless overwriting) that is currently empty — and only if changed.
        const put = (key: Field, current: string | null, next: string | null | undefined) => {
          if (!wants.has(key) || !next) return;
          if (!overwrite && current) return;
          if (next !== current) patch[key] = next;
        };
        put('phone', l.phone, p.phone);
        put('website', l.website, p.website);
        put('address', l.address, p.address);
        put('category', l.category, bestCategory(p.types, l.name));
        put('city', l.city, cityFromAddress(p.address ?? l.address));
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
