import type { NextRequest } from 'next/server';
import { restoreFromBuffer } from '@/lib/backup';
import { ApiError, enforceRateLimit, handleRouteError, jsonOk } from '@/lib/api-utils';
import { requireAuth } from '@/lib/session';

/**
 * POST /api/backup/restore   multipart/form-data { file: <.sqlite> }   (admin)
 * Validates the upload, snapshots the current DB as "pre-restore", then swaps it in.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 500 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    enforceRateLimit(req, 'restore', 3, 10 * 60_000);
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new ApiError(400, 'Upload a .sqlite file in the "file" field');
    if (file.size > MAX_BYTES) throw new ApiError(413, 'Backup file is too large');
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await restoreFromBuffer(buf);
    const { file: _f, ...pre } = result.preRestore;
    return jsonOk({ restored: true, listings: result.listings, preRestore: pre });
  } catch (err) {
    if (err instanceof Error && !(err as { status?: number }).status && /SQLite|listings|backup/i.test(err.message)) {
      return handleRouteError(new ApiError(400, err.message), 'POST /api/backup/restore');
    }
    return handleRouteError(err, 'POST /api/backup/restore');
  }
}
