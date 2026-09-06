import type { ListingStatus } from './db';
import { config, getEnv, requireEnv } from './env';
import { chargeGoogleCall, GoogleApiDisabledError, GoogleBudgetExceededError } from './google-budget';

/**
 * Google Places — Place Details.
 *
 * Two Google services exist and a key may be enabled for either:
 *   - "Places API" (legacy):   maps.googleapis.com/maps/api/place/details/json
 *   - "Places API (New)":      places.googleapis.com/v1/places/{id}
 *
 * GOOGLE_PLACES_API_VERSION = legacy | new | auto (default). In auto mode the
 * legacy endpoint is tried first; on REQUEST_DENIED the new endpoint is used
 * and remembered for the rest of the process.
 */
export const GOOGLE_PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
export const GOOGLE_PLACES_V1_URL = 'https://places.googleapis.com/v1/places';

export type GooglePlacesApiStatus =
  | 'OK'
  | 'ZERO_RESULTS'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'UNKNOWN_ERROR';

export type GoogleBusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';

export interface PlaceDetailsResponse {
  status: GooglePlacesApiStatus | string;
  result?: {
    name?: string;
    business_status?: GoogleBusinessStatus | string;
    place_id?: string;
  };
  error_message?: string;
  html_attributions?: string[];
  info_messages?: string[];
  /** Which Google service produced this payload. */
  api?: 'legacy' | 'new';
}

export type PlaceCheckOutcome =
  | {
      ok: true;
      status: ListingStatus;
      googleStatus: string;
      businessStatus: string | null;
      googleName: string | null;
      /** Real Place ID reported by Google (fills in "cid:" listings). */
      resolvedPlaceId: string | null;
      raw: PlaceDetailsResponse;
      /** Human-readable explanation of how the status was decided (free checks). */
      detail?: string;
    }
  | {
      ok: false;
      /** Human readable reason, safe to persist / show in UI. */
      reason: string;
      googleStatus: string | null;
      raw: unknown;
    };

type ApiVersion = 'legacy' | 'new';

/** Google statuses that mean "the listing is gone from Maps" → we treat as SUSPENDED. */
const MISSING_STATUSES: ReadonlySet<string> = new Set(['NOT_FOUND', 'INVALID_REQUEST', 'ZERO_RESULTS']);

/** Google statuses that are worth retrying with backoff. */
const TRANSIENT_STATUSES: ReadonlySet<string> = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR']);

/**
 * How a "temporarily closed" profile is classified. Google keeps the profile
 * live, but the business is flagged as closed. Change to 'ACTIVE' if you only
 * care about suspensions.
 */
const TEMPORARILY_CLOSED_MAPS_TO: ListingStatus = 'CLOSED';

const DENIED_HINT =
  'Enable "Places API" and/or "Places API (New)" for this key in Google Cloud Console → APIs & Services → Library, and check the key\'s API restrictions.';

export class GooglePlacesHttpError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'GooglePlacesHttpError';
  }
}

/** Remembered in auto mode once we learn which service the key is enabled for. */
let preferredVersion: ApiVersion | null = null;

function configuredVersion(): ApiVersion | 'auto' {
  const v = (getEnv('GOOGLE_PLACES_API_VERSION') ?? 'auto').toLowerCase();
  return v === 'legacy' || v === 'new' ? v : 'auto';
}

/**
 * Translate a Place Details payload into our internal status.
 * Returns `null` when the response is not definitive (quota / denied / unknown),
 * in which case the caller must NOT change the stored status.
 */
export function mapResponseToListingStatus(res: PlaceDetailsResponse): ListingStatus | null {
  if (MISSING_STATUSES.has(res.status)) return 'SUSPENDED';
  if (res.status !== 'OK') return null;

  switch (res.result?.business_status) {
    case 'OPERATIONAL':
      return 'ACTIVE';
    case 'CLOSED_PERMANENTLY':
      return 'CLOSED';
    case 'CLOSED_TEMPORARILY':
      return TEMPORARILY_CLOSED_MAPS_TO;
    default:
      // Google omits business_status for some place types (e.g. geographic
      // features). The place resolved, so the profile is live.
      return 'ACTIVE';
  }
}

function withTimeout(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  external?.addEventListener('abort', () => controller.abort(external.reason), { once: true });
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** Legacy "Places API" — single HTTP call, no retries. */
export async function fetchPlaceDetailsLegacy(placeId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PlaceDetailsResponse> {
  const apiKey = requireEnv('GOOGLE_PLACES_API_KEY');
  chargeGoogleCall('details');
  const url = new URL(GOOGLE_PLACE_DETAILS_URL);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,business_status');
  url.searchParams.set('key', apiKey);

  const t = withTimeout(options.timeoutMs ?? config.googleTimeoutMs, options.signal);
  try {
    const res = await fetch(url, { method: 'GET', signal: t.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) {
      // Never include the URL in the error — it contains the API key.
      throw new GooglePlacesHttpError(res.status, `Google Places responded with HTTP ${res.status}`);
    }
    const json = (await res.json()) as PlaceDetailsResponse;
    if (!json || typeof json.status !== 'string') {
      throw new Error('Google Places returned a malformed payload (missing "status")');
    }
    return { ...json, api: 'legacy' };
  } finally {
    t.clear();
  }
}

/** "Places API (New)" — normalised to the legacy response shape. */
export async function fetchPlaceDetailsNew(placeId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PlaceDetailsResponse> {
  const apiKey = requireEnv('GOOGLE_PLACES_API_KEY');
  chargeGoogleCall('details');
  const url = `${GOOGLE_PLACES_V1_URL}/${encodeURIComponent(placeId)}`;

  const t = withTimeout(options.timeoutMs ?? config.googleTimeoutMs, options.signal);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: t.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,displayName,businessStatus' },
    });
    const json = (await res.json().catch(() => null)) as
      | { id?: string; displayName?: { text?: string }; businessStatus?: string; error?: { status?: string; message?: string } }
      | null;

    if (res.ok && json) {
      return {
        status: 'OK',
        result: { name: json.displayName?.text, business_status: json.businessStatus, place_id: json.id ?? placeId },
        api: 'new',
      };
    }

    const st = json?.error?.status ?? '';
    const msg = json?.error?.message;
    if (res.status === 404 || st === 'NOT_FOUND') return { status: 'NOT_FOUND', error_message: msg, api: 'new' };
    if (res.status === 400 || st === 'INVALID_ARGUMENT') return { status: 'INVALID_REQUEST', error_message: msg, api: 'new' };
    if (res.status === 403 || st === 'PERMISSION_DENIED') return { status: 'REQUEST_DENIED', error_message: msg, api: 'new' };
    if (res.status === 429 || st === 'RESOURCE_EXHAUSTED') return { status: 'OVER_QUERY_LIMIT', error_message: msg, api: 'new' };
    if (res.status >= 500) throw new GooglePlacesHttpError(res.status, `Google Places (New) responded with HTTP ${res.status}`);
    return { status: 'UNKNOWN_ERROR', error_message: msg ?? `HTTP ${res.status}`, api: 'new' };
  } finally {
    t.clear();
  }
}

/** Listings imported from a Maps link without a Place ID are stored as "cid:<number>". */
export const CID_PREFIX = 'cid:';

export function isCidPlaceId(placeId: string): boolean {
  return placeId.startsWith(CID_PREFIX);
}

/**
 * Legacy Place Details by CID (undocumented `cid=` parameter). Returns the
 * same shape as a Place ID lookup, including the real `place_id`.
 */
export async function fetchPlaceDetailsByCidLegacy(cid: string, options: { timeoutMs?: number } = {}): Promise<PlaceDetailsResponse> {
  const apiKey = requireEnv('GOOGLE_PLACES_API_KEY');
  chargeGoogleCall('details');
  const url = new URL(GOOGLE_PLACE_DETAILS_URL);
  url.searchParams.set('cid', cid);
  url.searchParams.set('fields', 'place_id,name,business_status');
  url.searchParams.set('key', apiKey);
  const t = withTimeout(options.timeoutMs ?? config.googleTimeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: t.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new GooglePlacesHttpError(res.status, `Google Places responded with HTTP ${res.status}`);
    const json = (await res.json()) as PlaceDetailsResponse;
    if (!json || typeof json.status !== 'string') throw new Error('Google Places returned a malformed payload (missing "status")');
    return { ...json, api: 'legacy' };
  } finally {
    t.clear();
  }
}

/**
 * Fetch using the configured service. In auto mode, falls back from the legacy
 * service to the new one when the key is not authorised for the former.
 * "cid:<number>" identifiers always use the legacy service.
 */
export async function fetchPlaceDetails(placeId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PlaceDetailsResponse> {
  if (isCidPlaceId(placeId)) {
    const cid = placeId.slice(CID_PREFIX.length);
    const res = await fetchPlaceDetailsByCidLegacy(cid, options);
    if (res.status === 'REQUEST_DENIED') {
      return { ...res, error_message: `${res.error_message ?? 'REQUEST_DENIED'} — CID-based listings need the legacy "Places API" enabled for this key.` };
    }
    return res;
  }
  const mode = configuredVersion();
  if (mode === 'legacy') return fetchPlaceDetailsLegacy(placeId, options);
  if (mode === 'new') return fetchPlaceDetailsNew(placeId, options);

  const first: ApiVersion = preferredVersion ?? 'legacy';
  const second: ApiVersion = first === 'legacy' ? 'new' : 'legacy';
  const call = (v: ApiVersion) => (v === 'legacy' ? fetchPlaceDetailsLegacy(placeId, options) : fetchPlaceDetailsNew(placeId, options));

  const res = await call(first);
  if (res.status !== 'REQUEST_DENIED') return res;

  const alt = await call(second);
  if (alt.status !== 'REQUEST_DENIED') {
    if (preferredVersion !== second) console.info(`[google-places] key works with the ${second} service; using it from now on`);
    preferredVersion = second;
    return alt;
  }
  // Both denied: report the first error but with a helpful hint.
  return { ...res, error_message: `${res.error_message ?? 'REQUEST_DENIED'} ${DENIED_HINT}` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unknown error';
}

function isRetryable(err: unknown): boolean {
  if (err instanceof GoogleBudgetExceededError || err instanceof GoogleApiDisabledError) return false;
  if (err instanceof GooglePlacesHttpError) {
    return err.httpStatus === 429 || err.httpStatus >= 500;
  }
  // Network failures / timeouts (AbortError, fetch TypeError) are retryable.
  return true;
}

/**
 * Check a single Place ID with retry + exponential backoff for transient failures.
 *
 * Definitive outcomes (OK / NOT_FOUND / INVALID_REQUEST / ZERO_RESULTS) return
 * immediately. Non-retryable failures (REQUEST_DENIED, HTTP 4xx) return
 * `{ ok: false }` immediately. Everything else is retried up to `maxAttempts`.
 */
export async function checkPlace(placeId: string, options: { maxAttempts?: number; baseDelayMs?: number } = {}): Promise<PlaceCheckOutcome> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastError: unknown = null;
  let lastRaw: unknown = null;
  let lastGoogleStatus: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await fetchPlaceDetails(placeId);
      lastRaw = raw;
      lastGoogleStatus = raw.status;

      const status = mapResponseToListingStatus(raw);
      if (status) {
        return {
          ok: true,
          status,
          googleStatus: raw.status,
          businessStatus: raw.result?.business_status ?? null,
          googleName: raw.result?.name ?? null,
          resolvedPlaceId: raw.result?.place_id ?? null,
          raw,
        };
      }

      const detail = raw.error_message ? `: ${raw.error_message}` : '';
      lastError = new Error(`Google Places returned ${raw.status}${detail}`);

      if (!TRANSIENT_STATUSES.has(raw.status)) {
        // REQUEST_DENIED (bad key / billing) or something new — retrying is pointless.
        return { ok: false, reason: errorMessage(lastError), googleStatus: raw.status, raw };
      }
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) break;
    }

    if (attempt < maxAttempts) {
      // 500ms, 1000ms, 2000ms… plus jitter so 10 parallel workers don't retry in lock-step.
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 250;
      await sleep(delay);
    }
  }

  return {
    ok: false,
    reason: errorMessage(lastError),
    googleStatus: lastGoogleStatus,
    raw: lastRaw ?? { error: errorMessage(lastError) },
  };
}

/** Public Google Maps URL for a listing (CID link is the most stable). */
export function googleMapsUrl(placeId: string, cid?: string | null): string {
  if (cid) return `https://maps.google.com/?cid=${encodeURIComponent(cid)}`;
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

// ---------------------------------------------------------------------------
// Search (used to resolve Place IDs from name / phone / address)
// ---------------------------------------------------------------------------

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
}

export interface SearchOptions {
  /** Bias results towards a point (metres). */
  locationBias?: { lat: number; lng: number; radiusM: number };
  /** Max candidates to return. */
  limit?: number;
  timeoutMs?: number;
}

type LegacySearchResult = {
  place_id: string;
  name?: string;
  formatted_address?: string;
  business_status?: string;
  types?: string[];
  geometry?: { location?: { lat: number; lng: number } };
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
};

function legacyToCandidate(r: LegacySearchResult): PlaceCandidate {
  return {
    placeId: r.place_id,
    name: r.name ?? '',
    address: r.formatted_address ?? null,
    phone: r.international_phone_number ?? r.formatted_phone_number ?? null,
    website: r.website ?? null,
    businessStatus: r.business_status ?? null,
    lat: r.geometry?.location?.lat ?? null,
    lng: r.geometry?.location?.lng ?? null,
    types: r.types ?? [],
  };
}

/** Legacy Text Search. Returns candidates WITHOUT phone/website (enrich with fetchContactDetailsLegacy). */
async function searchPlacesLegacy(query: string, options: SearchOptions): Promise<{ status: string; results: PlaceCandidate[]; error?: string }> {
  const apiKey = requireEnv('GOOGLE_PLACES_API_KEY');
  chargeGoogleCall('search');
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);
  if (options.locationBias) {
    url.searchParams.set('location', `${options.locationBias.lat},${options.locationBias.lng}`);
    url.searchParams.set('radius', String(Math.round(options.locationBias.radiusM)));
  }
  const t = withTimeout(options.timeoutMs ?? config.googleTimeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new GooglePlacesHttpError(res.status, `Google Places responded with HTTP ${res.status}`);
    const json = (await res.json()) as { status: string; results?: LegacySearchResult[]; error_message?: string };
    return { status: json.status, results: (json.results ?? []).slice(0, options.limit ?? 5).map(legacyToCandidate), error: json.error_message };
  } finally {
    t.clear();
  }
}

/** Legacy Place Details limited to contact fields (phone / website / location). */
export async function fetchContactDetailsLegacy(placeId: string, timeoutMs?: number): Promise<Partial<PlaceCandidate>> {
  const apiKey = requireEnv('GOOGLE_PLACES_API_KEY');
  chargeGoogleCall('details');
  const url = new URL(GOOGLE_PLACE_DETAILS_URL);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'formatted_phone_number,international_phone_number,website,geometry');
  url.searchParams.set('key', apiKey);
  const t = withTimeout(timeoutMs ?? config.googleTimeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal, cache: 'no-store' });
    if (!res.ok) return {};
    const json = (await res.json()) as { status: string; result?: LegacySearchResult };
    if (json.status !== 'OK' || !json.result) return {};
    const r = json.result;
    return {
      phone: r.international_phone_number ?? r.formatted_phone_number ?? null,
      website: r.website ?? null,
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
    };
  } catch {
    return {};
  } finally {
    t.clear();
  }
}

/**
 * Legacy Place Details by CID (undocumented but long-supported `cid=` parameter).
 * Returns null when unsupported / not found.
 */
export async function fetchPlaceByCidLegacy(cid: string, timeoutMs?: number): Promise<PlaceCandidate | null> {
  const apiKey = requireEnv('GOOGLE_PLACES_API_KEY');
  chargeGoogleCall('details');
  const url = new URL(GOOGLE_PLACE_DETAILS_URL);
  url.searchParams.set('cid', cid);
  url.searchParams.set('fields', 'place_id,name,formatted_address,business_status,formatted_phone_number,international_phone_number,website,geometry,types');
  url.searchParams.set('key', apiKey);
  const t = withTimeout(timeoutMs ?? config.googleTimeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { status: string; result?: LegacySearchResult };
    if (json.status !== 'OK' || !json.result?.place_id) return null;
    return legacyToCandidate(json.result);
  } catch {
    return null;
  } finally {
    t.clear();
  }
}

/** Places API (New) Text Search — returns phone/website/location in one call. */
async function searchPlacesNew(query: string, options: SearchOptions): Promise<{ status: string; results: PlaceCandidate[]; error?: string }> {
  const apiKey = requireEnv('GOOGLE_PLACES_API_KEY');
  chargeGoogleCall('search');
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: Math.min(10, options.limit ?? 5) };
  if (options.locationBias) {
    body.locationBias = { circle: { center: { latitude: options.locationBias.lat, longitude: options.locationBias.lng }, radius: options.locationBias.radiusM } };
  }
  const t = withTimeout(options.timeoutMs ?? config.googleTimeoutMs);
  try {
    const res = await fetch(`${GOOGLE_PLACES_V1_URL}:searchText`, {
      method: 'POST',
      signal: t.signal,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.businessStatus,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.location,places.types',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | {
          places?: Array<{
            id: string;
            displayName?: { text?: string };
            formattedAddress?: string;
            businessStatus?: string;
            nationalPhoneNumber?: string;
            internationalPhoneNumber?: string;
            websiteUri?: string;
            location?: { latitude: number; longitude: number };
            types?: string[];
          }>;
          error?: { status?: string; message?: string };
        }
      | null;
    if (res.ok && json) {
      return {
        status: 'OK',
        results: (json.places ?? []).map((p) => ({
          placeId: p.id,
          name: p.displayName?.text ?? '',
          address: p.formattedAddress ?? null,
          phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
          website: p.websiteUri ?? null,
          businessStatus: p.businessStatus ?? null,
          lat: p.location?.latitude ?? null,
          lng: p.location?.longitude ?? null,
          types: p.types ?? [],
        })),
      };
    }
    const st = json?.error?.status ?? '';
    const msg = json?.error?.message;
    if (res.status === 403 || st === 'PERMISSION_DENIED') return { status: 'REQUEST_DENIED', results: [], error: msg };
    if (res.status === 429 || st === 'RESOURCE_EXHAUSTED') return { status: 'OVER_QUERY_LIMIT', results: [], error: msg };
    if (res.status === 400 || st === 'INVALID_ARGUMENT') return { status: 'INVALID_REQUEST', results: [], error: msg };
    if (res.status >= 500) throw new GooglePlacesHttpError(res.status, `Google Places (New) responded with HTTP ${res.status}`);
    return { status: 'UNKNOWN_ERROR', results: [], error: msg ?? `HTTP ${res.status}` };
  } finally {
    t.clear();
  }
}

/**
 * Search Google for places matching a free-text query. Uses the configured
 * service with the same legacy → new fallback as fetchPlaceDetails. Legacy
 * results are enriched with phone/website for the top candidates.
 */
export async function searchPlaces(query: string, options: SearchOptions = {}): Promise<PlaceCandidate[]> {
  const mode = configuredVersion();
  const run = async (v: ApiVersion) => (v === 'legacy' ? searchPlacesLegacy(query, options) : searchPlacesNew(query, options));

  let version: ApiVersion = mode === 'auto' ? preferredVersion ?? 'legacy' : mode;
  let res = await run(version);
  if (mode === 'auto' && res.status === 'REQUEST_DENIED') {
    const alt: ApiVersion = version === 'legacy' ? 'new' : 'legacy';
    const altRes = await run(alt);
    if (altRes.status !== 'REQUEST_DENIED') {
      preferredVersion = alt;
      version = alt;
      res = altRes;
    }
  }
  if (res.status === 'REQUEST_DENIED') throw new Error(`Google Places search denied: ${res.error ?? 'REQUEST_DENIED'} ${DENIED_HINT}`);
  if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS') throw new Error(`Google Places search failed: ${res.status}${res.error ? `: ${res.error}` : ''}`);

  if (version === 'legacy') {
    const top = res.results.slice(0, 3);
    const extras = await Promise.all(top.map((c) => fetchContactDetailsLegacy(c.placeId)));
    top.forEach((c, i) => Object.assign(c, extras[i]));
  }
  return res.results;
}
