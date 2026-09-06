import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { listings } from '@/lib/db';
import { ApiError, enforceRateLimit, handleRouteError, jsonOk } from '@/lib/api-utils';
import { requireAuth } from '@/lib/session';
import { totpCode } from '@/lib/totp';

/**
 * GET /api/listings/:id/credentials
 * Decrypted Google account credentials for one listing plus the current
 * 6-digit TOTP code (Google Authenticator compatible). Never listed in bulk.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    requireAuth(_req);
    enforceRateLimit(_req, 'credentials', 60, 60_000);
    const id = z.string().trim().min(1).max(64).parse((await ctx.params).id);
    const secrets = listings.getSecrets(id);
    if (!secrets) throw new ApiError(404, 'Listing not found');

    let totp: { code: string; expiresIn: number; step: number } | null = null;
    let totpError: string | null = null;
    if (secrets.totpSecret) {
      try {
        totp = totpCode(secrets.totpSecret);
      } catch (err) {
        totpError = err instanceof Error ? err.message : 'Invalid TOTP secret';
      }
    }

    return jsonOk({
      accountEmail: secrets.accountEmail,
      accountPassword: secrets.accountPassword,
      totpSecret: secrets.totpSecret,
      totp,
      totpError,
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/listings/[id]/credentials');
  }
}
