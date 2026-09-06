import { readFileSync } from 'node:fs';
import type { NextRequest } from 'next/server';
import { deleteBackup, getBackup } from '@/lib/backup';
import { ApiError, handleRouteError, jsonError, jsonOk } from '@/lib/api-utils';
import { getAuth, requireAuth } from '@/lib/session';

/**
 * GET    /api/backup/:name → download one backup file (admin)
 * DELETE /api/backup/:name → delete it (admin)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ name: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = getAuth(req);
    if (!auth) return jsonError(401, 'Sign in required');
    if (auth.user.role !== 'ADMIN') return jsonError(403, 'Admin access required');
    const b = getBackup((await ctx.params).name);
    if (!b) throw new ApiError(404, 'Backup not found');
    const body = readFileSync(b.file);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="gmb-guard-${b.name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/backup/[name]');
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    requireAuth(req, 'ADMIN');
    const name = (await ctx.params).name;
    if (!deleteBackup(name)) throw new ApiError(404, 'Backup not found');
    return jsonOk({ deleted: name });
  } catch (err) {
    return handleRouteError(err, 'DELETE /api/backup/[name]');
  }
}
