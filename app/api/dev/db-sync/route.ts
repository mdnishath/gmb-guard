import { databasePath, getDb, listings } from '@/lib/db';
import { handleRouteError, jsonOk } from '@/lib/api-utils';

/**
 * GET /api/dev/db-sync — health check. Opens the SQLite file (creating the
 * schema if needed) and reports where it lives. Kept for backwards
 * compatibility with earlier setup instructions.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    getDb();
    return jsonOk({ ok: true, database: databasePath(), listings: listings.count() });
  } catch (err) {
    return handleRouteError(err, 'GET /api/dev/db-sync');
  }
}
