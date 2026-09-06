import type { NextRequest } from 'next/server';
import { handleRouteError, jsonError } from '@/lib/api-utils';
import { getAppSecretHex } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { getAuth } from '@/lib/session';

/**
 * GET /api/backup/key → download the encryption key (admin).
 * Needed together with a database backup to read stored passwords / 2FA secrets.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth) return jsonError(401, 'Sign in required');
    if (auth.user.role !== 'ADMIN') return jsonError(403, 'Admin access required');
    const fromEnv = Boolean(getEnv('APP_SECRET'));
    const body = fromEnv
      ? '# APP_SECRET is set in the environment; the key is derived from it. Keep your .env safe — this file is informational.\n'
      : `${getAppSecretHex()}\n`;
    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="gmb-guard-app-secret.key"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/backup/key');
  }
}
