import type { NextRequest } from 'next/server';
import { sessions } from '@/lib/db';
import { handleRouteError, jsonOk } from '@/lib/api-utils';
import { clearSessionCookie, currentSessionId } from '@/lib/session';

/** POST /api/auth/logout — revoke the current session and clear the cookie. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const sid = currentSessionId(req);
    if (sid) sessions.remove(sid);
    const res = jsonOk({ signedOut: true });
    clearSessionCookie(res);
    return res;
  } catch (err) {
    return handleRouteError(err, 'POST /api/auth/logout');
  }
}
