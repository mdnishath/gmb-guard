import type { NextRequest } from 'next/server';
import { users } from '@/lib/db';
import { handleRouteError, jsonOk } from '@/lib/api-utils';
import { getAuth } from '@/lib/session';

/** GET /api/auth/status — public: is signup still open (no users yet)? Am I signed in? */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const hasUsers = users.count() > 0;
    const auth = getAuth(req);
    return jsonOk({ hasUsers, signupOpen: !hasUsers, user: auth?.user ?? null });
  } catch (err) {
    return handleRouteError(err, 'GET /api/auth/status');
  }
}
