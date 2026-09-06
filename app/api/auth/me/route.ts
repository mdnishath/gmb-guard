import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { sessions, users } from '@/lib/db';
import { ApiError, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { hashPassword, requireAuth, validatePasswordStrength, verifyPassword } from '@/lib/session';

/**
 * GET   /api/auth/me                      → current user
 * PATCH /api/auth/me  { name?, currentPassword?, newPassword? }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { user, session } = requireAuth(req);
    return jsonOk({ user, session: { createdAt: session.createdAt, expiresAt: session.expiresAt } });
  } catch (err) {
    return handleRouteError(err, 'GET /api/auth/me');
  }
}

const schema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    currentPassword: z.string().max(200).optional(),
    newPassword: z.string().max(200).optional(),
  })
  .refine((v) => v.name !== undefined || v.newPassword !== undefined, { message: 'Nothing to update' });

export async function PATCH(req: NextRequest) {
  try {
    const { user, session } = requireAuth(req);
    const input = await parseJsonBody(req, schema);
    const patch: { name?: string; passwordHash?: string } = {};
    if (input.name !== undefined) patch.name = input.name;

    if (input.newPassword !== undefined) {
      const full = users.getById(user.id);
      if (!full) throw new ApiError(404, 'User not found');
      if (!input.currentPassword || !verifyPassword(input.currentPassword, full.passwordHash)) throw new ApiError(400, 'Current password is incorrect');
      const weak = validatePasswordStrength(input.newPassword);
      if (weak) throw new ApiError(400, weak);
      patch.passwordHash = hashPassword(input.newPassword);
    }

    const updated = users.update(user.id, patch);
    if (!updated) throw new ApiError(404, 'User not found');
    // Changing the password signs out every other device.
    if (patch.passwordHash) sessions.removeForUser(user.id, session.id);
    return jsonOk({ user: users.toPublic(updated) });
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/auth/me');
  }
}
