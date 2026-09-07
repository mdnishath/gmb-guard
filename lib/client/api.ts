/**
 * Typed client for the app's own API routes. Browser-only (uses fetch).
 */

export type ListingStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type AlertChannel = 'TELEGRAM' | 'EMAIL';
export type AlertStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export interface Listing {
  id: string;
  name: string;
  placeId: string;
  cid: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  phone: string | null;
  website: string | null;
  sourceUrl: string | null;
  tag: string | null;
  notes: string | null;
  accountEmail: string | null;
  hasPassword: boolean;
  hasTotp: boolean;
  currentStatus: ListingStatus;
  monitoringEnabled: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  listingId: string;
  previousStatus: ListingStatus;
  newStatus: ListingStatus;
  checkedAt: string;
  rawApiResponse?: unknown;
  listing?: { name: string; placeId: string; cid: string | null; city: string | null; currentStatus: ListingStatus } | null;
}

export interface AlertLog {
  id: string;
  listingId: string | null;
  channel: AlertChannel;
  status: AlertStatus;
  recipient: string | null;
  event: string;
  previousStatus: ListingStatus | null;
  newStatus: ListingStatus | null;
  error: string | null;
  createdAt: string;
  listing?: { name: string; city: string | null } | null;
}

export interface CheckRun {
  id: string;
  trigger: 'CRON' | 'MANUAL';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  checked: number;
  changed: number;
  errors: number;
  skipped: number;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListingCheckResult {
  listingId: string;
  name: string;
  placeId: string;
  previousStatus: ListingStatus;
  newStatus: ListingStatus;
  changed: boolean;
  googleStatus: string | null;
  businessStatus: string | null;
  error: string | null;
  detail?: string | null;
  alertSent: boolean;
  checkedAt: string;
}

export interface CheckSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  checked: number;
  changed: number;
  errors: number;
  skipped: number;
  changes: ListingCheckResult[];
  failures: ListingCheckResult[];
  results?: ListingCheckResult[];
}

export interface Stats {
  total: number;
  distribution: Record<ListingStatus, number>;
  pending: number;
  monitoring: { enabled: number; paused: number; withErrors: number; globallyPaused: boolean };
  lastCheckedAt: string | null;
  lastRun: CheckRun | null;
  activity: {
    changesLast24h: number;
    suspensionsLast7d: number;
    suspensionsLast30d: number;
    recoveriesLast24h: number;
    recoveriesLast30d: number;
    alertsLast24h: number;
  };
  facets: { cities: string[]; categories: string[] };
}

export interface AppSettings {
  alertOnSuspended: boolean;
  alertOnClosed: boolean;
  alertOnRecovered: boolean;
  digestEnabled: boolean;
  extraEmailRecipients: string[];
  monitoringPaused: boolean;
  googleApiDisabled: boolean;
  checkMode: 'api' | 'free' | 'free-then-api';
}

export type UserRole = 'ADMIN' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  kind: 'auto' | 'manual' | 'pre-restore' | 'other';
}

export interface GoogleUsage {
  day: string;
  count: number;
  limit: number;
  byKind: Record<string, number>;
}

export interface SettingsResponse {
  usage: GoogleUsage;
  limits: { apiPerMinute: number; loginPer10Min: number; resolvePerMinute: number; importPer10Min: number; checkAllPer5Min: number };
  settings: AppSettings;
  channels: {
    telegram: { configured: boolean; chatId: string | null };
    email: { configured: boolean; from: string | null; envRecipients: string[]; extraRecipients: string[]; allRecipients: string[] };
  };
  google: { configured: boolean; disabled: boolean; disabledByEnv: boolean };
  cron: { configured: boolean; schedule: string; timezone: string };
  tuning: { concurrency: number; batchDelayMs: number; timeoutMs: number };
  appUrl: string | null;
}

export interface ReportsResponse {
  range: { from: string; to: string; days: number };
  series: Array<{ date: string; count: number }>;
  dropsToday: number;
  totalDrops: number;
  events: Array<{
    id: string;
    listingId: string;
    name: string;
    city: string | null;
    status: ListingStatus;
    suspendedAt: string;
    recoveredAt: string | null;
    durationMs: number;
    duration: string;
    currentStatus: ListingStatus;
  }>;
  distribution: Record<ListingStatus, number>;
  total: number;
  cities: Array<{ city: string; count: number }>;
  lowestUptime: Array<{ listingId: string; name: string; city: string | null; downMs: number; incidents: number; currentStatus: ListingStatus; uptimePct: number }>;
}

export interface ListingInput {
  name: string;
  placeId: string;
  cid?: string | null;
  address?: string | null;
  city?: string | null;
  category?: string | null;
  phone?: string | null;
  website?: string | null;
  sourceUrl?: string | null;
  tag?: string | null;
  notes?: string | null;
  accountEmail?: string | null;
  accountPassword?: string | null;
  totpSecret?: string | null;
}

export interface Credentials {
  accountEmail: string | null;
  accountPassword: string | null;
  totpSecret: string | null;
  totp: { code: string; expiresIn: number; step: number } | null;
  totpError: string | null;
}

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  businessStatus: string | null;
  lat: number | null;
  lng: number | null;
  types: string[];
  score: number;
  signals: string[];
}

export type Confidence = 'exact' | 'high' | 'medium' | 'low' | 'none';

export interface ResolveResult {
  candidates: PlaceCandidate[];
  best: PlaceCandidate | null;
  confidence: Confidence;
  mapsLink: { finalUrl: string | null; placeId: string | null; cid: string | null; name: string | null; lat: number | null; lng: number | null } | null;
  queries: string[];
  error: string | null;
}

export interface ResolveInput {
  name: string;
  phone?: string;
  address?: string;
  city?: string;
  website?: string;
  mapsUrl?: string;
}

export interface ListingListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ListingStatus | '';
  city?: string;
  category?: string;
  pending?: boolean;
  /** true = only listings whose last check failed / could not confirm. */
  hasError?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  let body: { success?: boolean; data?: T; error?: { message?: string; details?: unknown } } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body?.success) {
    const message = body?.error?.message ?? `Request failed (HTTP ${res.status})`;
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiClientError(res.status, message, body?.error?.details);
  }
  return body.data as T;
}

function qs(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  listings: {
    list: (p: ListingListParams = {}) => request<{ items: Listing[]; pagination: Pagination }>(`/api/listings${qs(p)}`),
    get: (id: string) => request<{ listing: Listing; history: AuditLog[]; alerts: AlertLog[] }>(`/api/listings/${encodeURIComponent(id)}`),
    create: (body: ListingInput & { checkImmediately?: boolean }) =>
      request<{ listing: Listing; initialCheck: ListingCheckResult | null }>('/api/listings', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<ListingInput> & { monitoringEnabled?: boolean }) =>
      request<{ listing: Listing }>(`/api/listings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ deleted: { id: string; name: string } }>(`/api/listings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    credentials: (id: string) => request<Credentials>(`/api/listings/${encodeURIComponent(id)}/credentials`),
    checkOne: (listingId: string) =>
      request<{ listing: Listing; result: ListingCheckResult | null }>('/api/listings/manual-check', {
        method: 'POST',
        body: JSON.stringify({ listingId }),
      }),
    checkMany: (listingIds: string[]) =>
      request<CheckSummary & { requested: number; found: number }>('/api/listings/manual-check', {
        method: 'POST',
        body: JSON.stringify({ listingIds }),
      }),
    checkAll: () => request<CheckSummary>('/api/listings/manual-check', { method: 'POST', body: JSON.stringify({ all: true }) }),
    stats: () => request<Stats>('/api/listings/stats'),
    import: (rows: ListingInput[], checkImmediately = true) =>
      request<{ received: number; imported: number; duplicates: number; invalid: Array<{ row: number; errors: string[] }>; check: CheckSummary | null; listings: Listing[] }>(
        '/api/listings/import',
        { method: 'POST', body: JSON.stringify({ rows, checkImmediately }) },
      ),
    /** Fill missing cities from addresses (admin). */
    backfill: () => request<{ updated: number }>('/api/listings/backfill', { method: 'POST' }),
    /** Find Place IDs on Google for up to 15 rows per call. */
    resolve: (rows: ResolveInput[], mode: 'auto' | 'free' = 'auto') =>
      request<{ results: ResolveResult[]; mode: 'auto' | 'free' }>('/api/listings/resolve', { method: 'POST', body: JSON.stringify({ rows, mode }) }),
  },
  auditLogs: (p: { listingId?: string; newStatus?: ListingStatus; since?: string; page?: number; pageSize?: number } = {}) =>
    request<{ items: AuditLog[]; pagination: Pagination }>(`/api/audit-logs${qs(p)}`),
  alertLogs: (p: { listingId?: string; event?: string; status?: AlertStatus; page?: number; pageSize?: number } = {}) =>
    request<{ items: AlertLog[]; pagination: Pagination }>(`/api/alert-logs${qs(p)}`),
  checkRuns: (limit = 10) => request<{ items: CheckRun[] }>(`/api/check-runs${qs({ limit })}`),
  /** Record a browser-driven "check all" run in the run history. */
  recordCheckRun: (body: { trigger: 'MANUAL'; startedAt: string; finishedAt: string; durationMs: number; total: number; checked: number; changed: number; errors: number; skipped: number }) =>
    request<{ run: CheckRun }>('/api/check-runs', { method: 'POST', body: JSON.stringify(body) }),
  reports: (p: { days?: number; from?: string; to?: string }) => request<ReportsResponse>(`/api/reports${qs(p)}`),
  auth: {
    status: () => request<{ hasUsers: boolean; signupOpen: boolean; user: User | null }>('/api/auth/status'),
    login: (body: { email: string; password: string; remember?: boolean }) => request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    signup: (body: { name: string; email: string; password: string }) => request<{ user: User }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => request<{ signedOut: boolean }>('/api/auth/logout', { method: 'POST' }),
    me: () => request<{ user: User; session: { createdAt: string; expiresAt: string } }>('/api/auth/me'),
    updateMe: (body: { name?: string; currentPassword?: string; newPassword?: string }) => request<{ user: User }>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  },
  users: {
    list: () => request<{ items: User[] }>('/api/users'),
    create: (body: { name: string; email: string; password: string; role: UserRole }) => request<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; role?: UserRole; password?: string }) => request<{ user: User }>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ deleted: { id: string; email: string } }>(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  backup: {
    list: () => request<{ items: BackupInfo[]; directory: string; database: string }>('/api/backup'),
    create: () => request<{ backup: BackupInfo }>('/api/backup', { method: 'POST' }),
    remove: (name: string) => request<{ deleted: string }>(`/api/backup/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    downloadUrl: (name: string) => `/api/backup/${encodeURIComponent(name)}`,
    keyUrl: () => '/api/backup/key',
    restore: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/backup/restore', { method: 'POST', body: fd });
      const body = (await res.json().catch(() => null)) as { success?: boolean; data?: { restored: boolean; listings: number; preRestore: BackupInfo }; error?: { message?: string } } | null;
      if (!res.ok || !body?.success || !body.data) throw new ApiClientError(res.status, body?.error?.message ?? `Restore failed (HTTP ${res.status})`);
      return body.data;
    },
  },
  settings: {
    get: () => request<SettingsResponse>('/api/settings'),
    patch: (body: Partial<AppSettings>) => request<SettingsResponse>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    testAlert: () =>
      request<{ channels: Array<{ channel: AlertChannel; status: 'sent' | 'skipped' | 'failed'; recipient: string | null; error: string | null }> }>(
        '/api/settings/test-alert',
        { method: 'POST' },
      ),
  },
};
