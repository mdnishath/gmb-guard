import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { USER_ROLES, users } from '@/lib/db';
import { ApiError, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { hashPassword, requireAuth, validatePasswordStrength } from '@/lib/session';

/**
 * GET  /api/users             → team list (any signed-in user)
 * POST /api/users             → add a teammate (admin)  { name, email, password, role }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return jsonOk({ items: users.list() });
  } catch (err) {
    return handleRouteError(err, 'GET /api/users');
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  role: z.enum(USER_ROLES).default('VIEWER'),
});

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    const input = await parseJsonBody(req, createSchema);
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new ApiError(400, weak);
    const user = users.create({ name: input.name, email: input.email, role: input.role, passwordHash: hashPassword(input.password) });
    return jsonOk({ user: users.toPublic(user) }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, 'POST /api/users');
  }
}
