import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { users } from '@/lib/db';
import { ApiError, enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { createSessionFor, setSessionCookie, verifyPassword } from '@/lib/session';

/** POST /api/auth/login  { email, password, remember? } */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email').max(200),
  password: z.string().min(1, 'Password is required').max(200),
  remember: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  try {
    enforceRateLimit(req, 'login', 10, 10 * 60_000);
    const input = await parseJsonBody(req, schema);
    enforceRateLimit(req, `login-email:${input.email.toLowerCase()}`, 8, 15 * 60_000);

    const user = users.findByEmail(input.email);
    // Same error for unknown email and wrong password (no account enumeration).
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new ApiError(401, 'Incorrect email or password');
    }

    users.update(user.id, { lastLoginAt: new Date().toISOString() });
    const { token, maxAgeSec } = createSessionFor(user, req, input.remember);
    const res = jsonOk({ user: users.toPublic(user) });
    setSessionCookie(res, token, maxAgeSec);
    return res;
  } catch (err) {
    return handleRouteError(err, 'POST /api/auth/login');
  }
}
