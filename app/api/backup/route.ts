import type { NextRequest } from 'next/server';
import { backupsDir, createBackup, listBackups } from '@/lib/backup';
import { enforceRateLimit, handleRouteError, jsonOk } from '@/lib/api-utils';
import { databasePath } from '@/lib/db';
import { requireAuth } from '@/lib/session';

/**
 * GET  /api/backup   → list backups (admin)
 * POST /api/backup   → create a backup now (admin)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    return jsonOk({ items: listBackups().map(({ file: _f, ...b }) => b), directory: backupsDir(), database: databasePath() });
  } catch (err) {
    return handleRouteError(err, 'GET /api/backup');
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    enforceRateLimit(req, 'backup', 10, 10 * 60_000);
    const { file: _f, ...b } = await createBackup('manual');
    return jsonOk({ backup: b }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, 'POST /api/backup');
  }
}
