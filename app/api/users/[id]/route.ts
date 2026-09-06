import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { sessions, USER_ROLES, users } from '@/lib/db';
import { ApiError, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { hashPassword, requireAuth, validatePasswordStrength } from '@/lib/session';

/**
 * PATCH  /api/users/:id  { name?, role?, password? }   (admin)
 * DELETE /api/users/:id                                (admin; not yourself, not the last admin)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    role: z.enum(USER_ROLES).optional(),
    password: z.string().max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const me = requireAuth(req, 'ADMIN');
    const id = (await ctx.params).id;
    const target = users.getById(id);
    if (!target) throw new ApiError(404, 'User not found');
    const input = await parseJsonBody(req, patchSchema);

    if (input.role === 'VIEWER' && target.role === 'ADMIN' && users.countAdmins() <= 1) throw new ApiError(400, 'There must be at least one admin');
    if (input.role === 'VIEWER' && target.id === me.user.id) throw new ApiError(400, 'You cannot demote yourself');

    const patch: { name?: string; role?: 'ADMIN' | 'VIEWER'; passwordHash?: string } = { name: input.name, role: input.role };
    if (input.password) {
      const weak = validatePasswordStrength(input.password);
      if (weak) throw new ApiError(400, weak);
      patch.passwordHash = hashPassword(input.password);
    }
    const updated = users.update(id, patch);
    if (patch.passwordHash || input.role) sessions.removeForUser(id);
    return jsonOk({ user: users.toPublic(updated!) });
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/users/[id]');
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const me = requireAuth(req, 'ADMIN');
    const id = (await ctx.params).id;
    const target = users.getById(id);
    if (!target) throw new ApiError(404, 'User not found');
    if (target.id === me.user.id) throw new ApiError(400, 'You cannot remove yourself');
    if (target.role === 'ADMIN' && users.countAdmins() <= 1) throw new ApiError(400, 'There must be at least one admin');
    sessions.removeForUser(id);
    users.remove(id);
    return jsonOk({ deleted: { id, email: target.email } });
  } catch (err) {
    return handleRouteError(err, 'DELETE /api/users/[id]');
  }
}
