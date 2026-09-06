import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { ApiError } from './api-utils';
import { getAppSecretHex } from './crypto';
import { sessions, users, type PublicUser, type Session, type UserRole } from './db';
import { getEnv } from './env';

/**
 * Cookie sessions. The cookie carries an HMAC-signed payload so the Edge
 * middleware can verify it without a database; API routes additionally check
 * the session row so sign-out / user removal revoke access immediately.
 */

export const SESSION_COOKIE = 'gmb_session';
export const SESSION_DAYS = 7;
export const SESSION_DAYS_REMEMBER = 30;

export interface SessionPayload {
  sid: string;
  uid: string;
  role: UserRole;
  exp: number; // unix seconds
}

export interface AuthContext {
  user: PublicUser;
  session: Session;
}

/** SESSION_SECRET > APP_SECRET > generated key file (same file lib/crypto.ts uses). */
export function getSessionSecret(): string {
  return getEnv('SESSION_SECRET') ?? getEnv('APP_SECRET') ?? getAppSecretHex();
}

// ---------------------------------------------------------------------------
// Passwords (scrypt)
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, nStr, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(nStr), r: 8, p: 1 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 200) return 'Password is too long';
  return null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const b64url = (buf: Buffer) => buf.toString('base64url');

export function signSession(payload: SessionPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', getSessionSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', getSessionSecret()).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.sid || !payload.uid || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function setSessionCookie(res: NextResponse, token: string, maxAgeSec: number): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && !/^http:\/\//i.test(getEnv('APP_URL') ?? ''),
    path: '/',
    maxAge: maxAgeSec,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export function createSessionFor(user: { id: string; role: UserRole }, req: Request, remember: boolean): { token: string; maxAgeSec: number } {
  const days = remember ? SESSION_DAYS_REMEMBER : SESSION_DAYS;
  const maxAgeSec = days * 24 * 60 * 60;
  const sid = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + maxAgeSec * 1000);
  const xff = req.headers.get('x-forwarded-for');
  sessions.create({
    id: sid,
    userId: user.id,
    expiresAt,
    ip: xff ? xff.split(',')[0].trim() : req.headers.get('x-real-ip'),
    userAgent: req.headers.get('user-agent'),
  });
  if (Math.random() < 0.05) sessions.purgeExpired();
  const token = signSession({ sid, uid: user.id, role: user.role, exp: Math.floor(expiresAt.getTime() / 1000) });
  return { token, maxAgeSec };
}

/** Resolve the current user from the request cookie (signature + DB session + user row). */
export function getAuth(req: Request): AuthContext | null {
  const payload = verifySessionToken(readCookie(req, SESSION_COOKIE));
  if (!payload) return null;
  const session = sessions.get(payload.sid);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  const user = users.getById(session.userId);
  if (!user) return null;
  if (Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60_000) sessions.touch(session.id);
  return { user: users.toPublic(user), session };
}

/** Throw 401 / 403 unless the request is authenticated (and, optionally, an admin). */
export function requireAuth(req: Request, role?: 'ADMIN'): AuthContext {
  const auth = getAuth(req);
  if (!auth) throw new ApiError(401, 'Sign in required');
  if (role === 'ADMIN' && auth.user.role !== 'ADMIN') throw new ApiError(403, 'Admin access required');
  return auth;
}

export function currentSessionId(req: Request): string | null {
  return verifySessionToken(readCookie(req, SESSION_COOKIE))?.sid ?? null;
}
