import { timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Vercel Cron calls the endpoint with `Authorization: Bearer <CRON_SECRET>`.
 * We also accept `x-cron-secret: <CRON_SECRET>` for manual curl / Postman runs.
 *
 * If CRON_SECRET is not configured the endpoint is locked (fail closed).
 */
export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = getEnv('CRON_SECRET');
  if (!secret) {
    console.error('[auth] CRON_SECRET is not set — refusing cron request');
    return false;
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
  const custom = req.headers.get('x-cron-secret')?.trim() ?? null;

  return [bearer, custom].some((candidate) => candidate !== null && candidate.length > 0 && safeEqual(candidate, secret));
}
