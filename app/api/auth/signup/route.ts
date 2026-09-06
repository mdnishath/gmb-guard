import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { users } from '@/lib/db';
import { ApiError, enforceRateLimit, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { createSessionFor, hashPassword, setSessionCookie, validatePasswordStrength } from '@/lib/session';

/**
 * POST /api/auth/signup  { name, email, password }
 * Creates the FIRST user (the workspace admin). Afterwards signup is closed;
 * admins add teammates under Settings → Team.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Enter a valid email').max(200),
  password: z.string().min(1, 'Password is required').max(200),
});

export async function POST(req: NextRequest) {
  try {
    enforceRateLimit(req, 'signup', 10, 10 * 60_000);
    const input = await parseJsonBody(req, schema);
    if (users.count() > 0) throw new ApiError(403, 'Signup is closed. Ask an admin to add you under Settings → Team.');
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new ApiError(400, weak);

    const user = users.create({ name: input.name, email: input.email, role: 'ADMIN', passwordHash: hashPassword(input.password) });
    users.update(user.id, { lastLoginAt: new Date().toISOString() });
    const { token, maxAgeSec } = createSessionFor(user, req, true);
    const res = jsonOk({ user: users.toPublic(user) }, { status: 201 });
    setSessionCookie(res, token, maxAgeSec);
    return res;
  } catch (err) {
    return handleRouteError(err, 'POST /api/auth/signup');
  }
}
