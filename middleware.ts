import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { verifySessionTokenEdge } from '@/lib/session-edge';

/**
 * Auth gate + coarse rate limiting for every page and API route.
 *
 *  - Public: /login, /api/auth/(login|signup|status), /api/cron/* (own secret).
 *  - Everything else needs a valid session cookie (signature + expiry checked
 *    here; API routes re-check the session row so sign-out revokes instantly).
 *  - Viewers may only read: non-GET API calls are rejected with 403.
 *  - Rate limits: 600 API requests / minute / IP, 10 login attempts / 10 min / IP.
 */

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map|txt|woff2?)$).*)'],
};

const PUBLIC = [/^\/login$/, /^\/api\/auth\/(login|signup|status)$/, /^\/api\/cron\//];
const SESSION_COOKIE = 'gmb_session';
let warnedNoSecret = false;

function tooMany(retryAfterSec: number): NextResponse {
  const res = NextResponse.json({ success: false, error: { message: `Too many requests — try again in ${retryAfterSec}s` } }, { status: 429 });
  res.headers.set('Retry-After', String(retryAfterSec));
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const ip = clientIp(req);

  if (isApi) {
    const r = rateLimit(`api:${ip}`, 600, 60_000);
    if (!r.ok) return tooMany(r.retryAfterSec);
  }
  if (/^\/api\/auth\/(login|signup)$/.test(pathname) && req.method === 'POST') {
    const r = rateLimit(`auth:${ip}`, 10, 10 * 60_000);
    if (!r.ok) return tooMany(r.retryAfterSec);
  }

  const secret = process.env.SESSION_SECRET ?? process.env.APP_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let payload = null;
  if (token && secret) payload = await verifySessionTokenEdge(token, secret);

  if (PUBLIC.some((re) => re.test(pathname))) {
    if (pathname === '/login' && payload) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }

  if (!secret) {
    // Should not happen: next.config.mjs derives SESSION_SECRET from the key file.
    if (!warnedNoSecret) {
      console.error('[middleware] SESSION_SECRET is not available — auth cannot be verified at the edge; API routes still verify sessions.');
      warnedNoSecret = true;
    }
    return NextResponse.next();
  }

  if (!payload) {
    if (isApi) return NextResponse.json({ success: false, error: { message: 'Sign in required' } }, { status: 401 });
    const login = new URL('/login', req.url);
    if (pathname !== '/') login.searchParams.set('next', pathname + search);
    return NextResponse.redirect(login);
  }

  if (payload.role === 'VIEWER' && isApi && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !pathname.startsWith('/api/auth/')) {
    return NextResponse.json({ success: false, error: { message: 'Viewers cannot make changes' } }, { status: 403 });
  }

  const headers = new Headers(req.headers);
  headers.set('x-user-id', payload.uid);
  headers.set('x-user-role', payload.role);
  return NextResponse.next({ request: { headers } });
}
