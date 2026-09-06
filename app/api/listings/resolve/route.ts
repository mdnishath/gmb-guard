import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { resolveMany } from '@/lib/place-resolver';

/**
 * POST /api/listings/resolve
 *   { rows: [{ name, phone?, address?, city?, website?, mapsUrl? }, …] }   (max 15 per call)
 *
 * Finds the Google Place ID for each business using Maps links, phone number,
 * name + address. Returns scored candidates and a confidence per row. The
 * client calls this in chunks so it can show progress.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const opt = (max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : String(v).trim()), z.string().max(max).optional());

const rowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: opt(40),
  address: opt(300),
  city: opt(120),
  website: opt(300),
  mapsUrl: opt(1000),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(15),
  /** 'free' = Maps link + page only, no Google API calls. */
  mode: z.enum(['auto', 'free']).default('auto'),
});

export async function POST(req: NextRequest) {
  try {
    enforceRateLimit(req, 'resolve', 20, 60_000);
    const { rows, mode } = await parseJsonBody(req, bodySchema);
    const results = await resolveMany(rows, 4, { mode });
    return jsonOk({ results, mode });
  } catch (err) {
    return handleRouteError(err, 'POST /api/listings/resolve');
  }
}
