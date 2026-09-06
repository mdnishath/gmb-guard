import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { UniqueConstraintError } from './db';
import { clientIp, rateLimit } from './rate-limit';

/**
 * Uniform JSON envelope for every route:
 *   success → { success: true,  data: T }
 *   failure → { success: false, error: { message, details? } }
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, data }, init);
}

export function jsonError(status: number, message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { success: false, error: { message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

/** Parse and validate a JSON request body against a zod schema. */
export async function parseJsonBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON');
  }
  return schema.parse(body);
}

/** Parse and validate URL search params against a zod schema. */
export function parseSearchParams<S extends ZodTypeAny>(searchParams: URLSearchParams, schema: S): z.output<S> {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    // Treat "?status=" as "not provided" so <select> "All" options work.
    if (value.trim() !== '') raw[key] = value;
  });
  return schema.parse(raw);
}

/** Throw 429 when `limit` requests per `windowMs` for this client + bucket are exceeded. */
export function enforceRateLimit(req: Request, bucket: string, limit: number, windowMs: number): void {
  const r = rateLimit(`${bucket}:${clientIp(req)}`, limit, windowMs);
  if (!r.ok) throw new ApiError(429, `Too many requests — try again in ${r.retryAfterSec}s`, { retryAfterSec: r.retryAfterSec });
}

export function pagination(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
}

/**
 * Translate any thrown value into a well-formed error response.
 * Only 5xx errors are logged with the stack; client errors are expected.
 */
export function handleRouteError(err: unknown, context: string): NextResponse {
  if (err instanceof ApiError) {
    const res = jsonError(err.status, err.message, err.details);
    const retry = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
    if (err.status === 429 && retry) res.headers.set('Retry-After', String(retry));
    return res;
  }

  if (err instanceof ZodError) {
    return jsonError(400, 'Validation failed', err.flatten());
  }

  if (err instanceof UniqueConstraintError) {
    return jsonError(409, err.message);
  }

  const code = (err as { code?: string } | null)?.code;
  if (typeof code === 'string' && code.startsWith('SQLITE_')) {
    console.error(`[${context}] SQLite error ${code}:`, err instanceof Error ? err.message : err);
    return jsonError(500, 'Database error');
  }

  console.error(`[${context}] Unhandled error:`, err);
  return jsonError(500, 'Internal server error');
}
