import { fetchPlaceByCidLegacy, searchPlaces, type PlaceCandidate } from './google-places';
import { getEnv } from './env';
import { isGoogleApiDisabled } from './settings';

/**
 * Resolve a Google Place ID for a business from whatever the client has:
 * name, phone, address/city, website and/or a Google Maps link.
 *
 * Strategy (all signals are combined into a score per candidate):
 *   1. Maps link → follow redirects, read the place name, coordinates and CID
 *      from the final URL (g.page/r/… links carry the CID without a request).
 *   2. CID → direct lookup (exact match when the key allows it).
 *   3. Google Text Search by phone, and by "name + address", biased to the
 *      coordinates from step 1 when available.
 *   4. Score: phone match, distance, name similarity, website, postal code.
 */

export interface ResolveInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  website?: string | null;
  mapsUrl?: string | null;
}

export type Confidence = 'exact' | 'high' | 'medium' | 'low' | 'none';

export interface ScoredCandidate extends PlaceCandidate {
  score: number;
  signals: string[];
}

export interface MapsLinkInfo {
  finalUrl: string | null;
  placeId: string | null;
  cid: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

export interface ResolveResult {
  candidates: ScoredCandidate[];
  best: ScoredCandidate | null;
  confidence: Confidence;
  mapsLink: MapsLinkInfo | null;
  /** Search queries that were sent to Google (for diagnostics). */
  queries: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const STOP = new Set(['the', 'and', 'et', 'de', 'du', 'des', 'la', 'le', 'les', 'llc', 'inc', 'ltd', 'co', 'sarl', 'sas', 'eurl', 'company']);

function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalizeText(s)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** 0..1 similarity between two business names. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter += 1;
  });
  return inter / (ta.size + tb.size - inter);
}

export function phoneDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/** Compare the significant tail of two phone numbers (ignores country code / trunk 0). */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (da.length < 7 || db.length < 7) return false;
  const n = Math.min(9, da.length, db.length);
  return da.slice(-n) === db.slice(-n);
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function linkPoint(link: MapsLinkInfo | null): { lat: number; lng: number } | null {
  if (!link || link.lat === null || link.lng === null) return null;
  return { lat: link.lat, lng: link.lng };
}

function postalCode(s: string | null | undefined): string | null {
  const m = (s ?? '').match(/\b\d{5}\b/);
  return m ? m[0] : null;
}

/** Country calling code guessed from the address text; falls back to DEFAULT_PHONE_COUNTRY_CODE. */
function countryCode(address: string | null | undefined): string {
  const a = (address ?? '').toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/\bfrance\b/, '33'],
    [/\b(uk|united kingdom|england|scotland|wales)\b/, '44'],
    [/\bbangladesh\b/, '880'],
    [/\bindia\b/, '91'],
    [/\baustralia\b/, '61'],
    [/\b(germany|deutschland)\b/, '49'],
    [/\b(spain|espana|españa)\b/, '34'],
    [/\b(italy|italia)\b/, '39'],
    [/\bcanada\b/, '1'],
    [/\b(usa|united states)\b/, '1'],
  ];
  for (const [re, cc] of table) if (re.test(a)) return cc;
  return getEnv('DEFAULT_PHONE_COUNTRY_CODE') ?? '1';
}

/** Best-effort E.164 for search queries. */
function toE164(phone: string, address: string | null | undefined): string {
  const raw = phone.trim();
  if (raw.startsWith('+')) return `+${phoneDigits(raw)}`;
  let d = phoneDigits(raw);
  const cc = countryCode(address);
  if (d.startsWith('00')) return `+${d.slice(2)}`;
  if (d.length > 10 && d.startsWith(cc)) return `+${d}`;
  if (d.startsWith('0')) d = d.slice(1);
  return `+${cc}${d}`;
}

// ---------------------------------------------------------------------------
// Maps link expansion
// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** g.page/r/<base64url protobuf> — field 1 (fixed64) is the CID. */
function cidFromGPage(url: string): string | null {
  const m = url.match(/g\.page\/r\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64');
    if (bytes.length < 9 || bytes[0] !== 0x09) return null;
    return bytes.readBigUInt64LE(1).toString();
  } catch {
    return null;
  }
}

export function parseMapsUrl(url: string): Omit<MapsLinkInfo, 'finalUrl'> {
  const out: Omit<MapsLinkInfo, 'finalUrl'> = { placeId: null, cid: null, name: null, lat: null, lng: null };
  let u = url;
  try {
    // consent.google.com wraps the real URL in ?continue=
    const parsed = new URL(url);
    const cont = parsed.searchParams.get('continue');
    if (cont) u = decodeURIComponent(cont);
  } catch {
    /* not a URL */
  }

  // place_id=…, query_place_id=…, !1sChIJ…, !19sChIJ…, or a bare ChIJ… anywhere in the URL
  const pid =
    u.match(/[?&!](?:query_)?place_id[:=]([A-Za-z0-9_-]{10,})/) ??
    u.match(/!(?:1|19)s(ChIJ[A-Za-z0-9_-]{10,})/) ??
    u.match(/(ChIJ[A-Za-z0-9_-]{16,})/);
  if (pid) out.placeId = pid[1];

  const cidParam = u.match(/[?&]cid=(\d{1,20})(?!\d)/);
  if (cidParam && BigInt(cidParam[1]) <= 18446744073709551615n) out.cid = cidParam[1];
  if (!out.cid) {
    const ftid = u.match(/!1s0x[0-9a-f]+:0x([0-9a-f]+)/i) ?? u.match(/ftid=0x[0-9a-f]+:0x([0-9a-f]+)/i);
    if (ftid) out.cid = BigInt(`0x${ftid[1]}`).toString();
  }
  if (!out.cid) out.cid = cidFromGPage(u);

  const name = u.match(/\/maps\/place\/([^/@?]+)/);
  if (name) {
    try {
      out.name = decodeURIComponent(name[1].replace(/\+/g, ' ')).trim();
    } catch {
      out.name = name[1].replace(/\+/g, ' ');
    }
  }

  // Prefer the place pin (!3d/!4d) over the viewport centre (@lat,lng).
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const m = pin ?? at;
  if (m) {
    out.lat = Number(m[1]);
    out.lng = Number(m[2]);
  }
  return out;
}

/** Follow short-link redirects (maps.app.goo.gl, goo.gl/maps, g.page) and parse the final URL. */
export async function expandMapsUrl(input: string, timeoutMs = 8000): Promise<MapsLinkInfo> {
  const start = input.trim();
  const quick = parseMapsUrl(start);
  const isShort = /maps\.app\.goo\.gl|goo\.gl\/maps|g\.page\/|maps\.google\.[a-z.]+\/\?q=|share\.google/i.test(start);
  if (!isShort && (quick.placeId || quick.cid || quick.lat !== null)) return { finalUrl: start, ...quick };

  let url = start;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'text/html' } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url).toString();
        const info = parseMapsUrl(url);
        if (info.placeId || info.cid || info.lat !== null) return { finalUrl: url, ...info };
        continue;
      }
      // Some short links land on a 200 page (interstitial / consent) with the target in the HTML.
      if (res.ok) {
        const html = (await res.text().catch(() => '')).replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
        const m = html.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/(?:place|search)\/[^"'<\s\\]+/) ?? html.match(/https:\/\/maps\.google\.[a-z.]+\/[^"'<\s\\]*cid=\d+[^"'<\s\\]*/);
        if (m) {
          const target = m[0];
          const info = parseMapsUrl(target);
          if (info.placeId || info.cid || info.lat !== null) return { finalUrl: target, ...info };
        }
        // Last resort: any FTID / place id / cid anywhere in the page.
        const ftid = html.match(/0x[0-9a-f]{8,}:0x([0-9a-f]{8,})/i);
        const pid = html.match(/ChIJ[A-Za-z0-9_-]{20,40}/);
        const cidQ = html.match(/[?&]cid=(\d{5,25})/);
        if (ftid || pid || cidQ) {
          return {
            finalUrl: url,
            placeId: pid ? pid[0] : null,
            cid: cidQ ? cidQ[1] : ftid ? BigInt(`0x${ftid[1]}`).toString() : null,
            name: parseMapsUrl(url).name,
            lat: null,
            lng: null,
          };
        }
      }
      break;
    }
  } catch (err) {
    console.warn('[place-resolver] could not expand maps url:', err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
  return { finalUrl: url !== start ? url : null, ...(url !== start ? parseMapsUrl(url) : quick) };
}

export interface MapsPageInfo {
  placeId: string | null;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  /** What happened while fetching (for the /api/dev/scrape diagnostics). */
  diagnostics: MapsPageDiagnostics[];
}

export interface MapsPageDiagnostics {
  url: string;
  status: number | null;
  finalUrl: string | null;
  bytes: number;
  title: string | null;
  consentPage: boolean;
  hasAppState: boolean;
  chijCount: number;
  ogTitle: string | null;
  ogDescription: string | null;
  error: string | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\"/g, '"')
    .trim();
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re);
  const v = m ? (m[1] ?? m[2]) : null;
  return v ? decodeEntities(v) : null;
}

/**
 * Read a Google Maps place page WITHOUT the Places API. The initial HTML
 * embeds the Place ID (ChIJ…) plus name / address / phone / category in its
 * meta tags and bootstrap JSON. Works for service-area businesses that Text
 * Search never returns, and costs nothing. Best-effort: any field may be null.
 */
const BROWSER_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  // Skip the EU consent interstitial.
  Cookie: 'CONSENT=YES+cb.20240101-00-p0.en+FX+000; SOCS=CAESEwgDEgk2OTk4Njk1MTUaAmVuIAEaBgiA_sqxBg',
};

/** Unescape the JSON-in-JS bootstrap blob so regexes see plain text. */
function unescapeBlob(s: string): string {
  return s
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\u0022|\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, ' ');
}

function parseMapsHtml(html: string): Omit<MapsPageInfo, 'diagnostics'> & { chijCount: number; hasAppState: boolean; consentPage: boolean; title: string | null; ogTitle: string | null; ogDescription: string | null } {
  const plain = unescapeBlob(html);

  // Place ID: the most frequent ChIJ token on the page.
  const counts = new Map<string, number>();
  for (const m of plain.matchAll(/ChIJ[A-Za-z0-9_-]{20,40}/g)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  const placeId = counts.size ? Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0] : null;

  // Name / address / category from meta tags ("Name · Address", "★★★★☆ · Electrician").
  const ogTitle = meta(html, 'og:title');
  const ogDesc = meta(html, 'og:description');
  const titleRaw = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null;
  const title = titleRaw ? decodeEntities(titleRaw) : null;
  let name: string | null = null;
  let address: string | null = null;
  if (ogTitle) {
    const parts = ogTitle.split(' · ');
    name = parts[0]?.trim() || null;
    if (parts.length > 1) address = parts.slice(1).join(' · ').trim() || null;
  }
  if (!name && title && !/^Google Maps$/i.test(title)) name = title.replace(/\s*-\s*Google Maps\s*$/i, '').trim() || null;

  let category: string | null = null;
  if (ogDesc) {
    const parts = ogDesc.split(' · ').map((p) => p.trim());
    const cat = parts.find((p) => p && !/[★☆]|\d[.,]\d|review|avis|^\d+$/i.test(p));
    if (cat && cat.length <= 60) category = cat.replace(/\s+in\s+.+$/i, '').trim() || null;
  }
  if (!category) {
    // Category sits next to the name in the bootstrap blob, e.g. ["Electrician"] or "Electrician in Paris".
    const m = plain.match(/"((?:[A-Z][a-zà-ÿ]+ ?){1,4}(?:contractor|electrician|plumber|service|services|company|store|shop|salon|clinic|agency|firm|restaurant|repair|dentist|lawyer|bakery|cafe|bar|hotel|school|gym|studio|center|centre))"/);
    if (m && m[1].length <= 50) category = m[1].trim();
  }

  // Address fallback: a quoted string with a postal code ("5 Rue de Turenne, 75004 Paris, France").
  if (!address) {
    const m = plain.match(/"([^"\n]{4,90}?, ?\d{4,5} [^"\n]{2,40}?(?:, ?[A-Z][A-Za-z ]{2,30})?)"/);
    if (m) address = m[1].trim();
  }

  // Phone: tel: link or an international number in the blob.
  const tel = plain.match(/tel:(\+?[\d][\d\s().-]{6,20})/) ?? plain.match(/"(\+\d{1,3}[\s\d().-]{7,18}\d)"/);
  const phone = tel ? tel[1].replace(/[^\d+\s().-]/g, '').trim() : null;

  // Website: first non-Google http(s) URL in the blob (best-effort).
  const site = plain.match(/"(https?:\/\/(?!(?:www\.|maps\.|business\.|support\.)?google\.|maps\.gstatic|schema\.org|gstatic|ggpht|googleusercontent|apple\.com|w3\.org)[^"\s]{6,120})"/);
  const website = site ? site[1] : null;

  return {
    placeId,
    name,
    address,
    phone,
    website,
    category,
    chijCount: counts.size,
    hasAppState: /APP_INITIALIZATION_STATE/.test(html),
    consentPage: /consent\.google\.com|Before you continue to Google/i.test(html),
    title,
    ogTitle,
    ogDescription: ogDesc,
  };
}

/** Public parser (used by the API-free status check). */
export function parseMapsPageHtml(html: string) {
  return parseMapsHtml(html);
}

/** Plain fetch of a Maps page with browser-like headers. Never throws. */
export async function fetchMapsPageRaw(url: string, timeoutMs = 12000, userAgent?: string): Promise<{ html: string | null; status: number | null; finalUrl: string | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = userAgent ? { ...BROWSER_HEADERS, 'User-Agent': userAgent } : BROWSER_HEADERS;
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers });
    const html = await res.text();
    return { html, status: res.status, finalUrl: res.url || null, error: null };
  } catch (err) {
    return { html: null, status: null, finalUrl: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch one URL and parse it. Never throws; errors land in diagnostics.
 */
async function fetchMapsHtml(url: string, timeoutMs: number): Promise<{ html: string | null; diag: MapsPageDiagnostics }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const diag: MapsPageDiagnostics = { url, status: null, finalUrl: null, bytes: 0, title: null, consentPage: false, hasAppState: false, chijCount: 0, ogTitle: null, ogDescription: null, error: null };
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: BROWSER_HEADERS });
    diag.status = res.status;
    diag.finalUrl = res.url || null;
    const html = await res.text();
    diag.bytes = html.length;
    const p = parseMapsHtml(html);
    diag.title = p.title;
    diag.consentPage = p.consentPage;
    diag.hasAppState = p.hasAppState;
    diag.chijCount = p.chijCount;
    diag.ogTitle = p.ogTitle;
    diag.ogDescription = p.ogDescription;
    return { html: res.ok ? html : null, diag };
  } catch (err) {
    diag.error = err instanceof Error ? err.message : String(err);
    return { html: null, diag };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a Google Maps place page WITHOUT the Places API. Tries several URL
 * variants (the expanded link, the cid= page, the classic maps page) until
 * a Place ID or contact details show up. Best-effort: any field may be null.
 */
export async function scrapeMapsPage(url: string, timeoutMs = 12000, cid?: string | null): Promise<MapsPageInfo | null> {
  const variants: string[] = [];
  const withHl = (s: string) => {
    try {
      const u = new URL(s);
      u.searchParams.set('hl', 'en');
      return u.toString();
    } catch {
      return s;
    }
  };
  variants.push(withHl(url));
  const cidFromUrl = cid ?? parseMapsUrl(url).cid;
  if (cidFromUrl) {
    variants.push(`https://www.google.com/maps?cid=${cidFromUrl}&hl=en`);
    variants.push(`https://maps.google.com/maps?cid=${cidFromUrl}&hl=en&output=classic`);
  }

  const diagnostics: MapsPageDiagnostics[] = [];
  let best: Omit<MapsPageInfo, 'diagnostics'> | null = null;
  for (const v of Array.from(new Set(variants))) {
    const { html, diag } = await fetchMapsHtml(v, timeoutMs);
    diagnostics.push(diag);
    if (!html) continue;
    const p = parseMapsHtml(html);
    const info = { placeId: p.placeId, name: p.name, address: p.address, phone: p.phone, website: p.website, category: p.category };
    if (!best) best = info;
    else {
      best = {
        placeId: best.placeId ?? info.placeId,
        name: best.name ?? info.name,
        address: best.address ?? info.address,
        phone: best.phone ?? info.phone,
        website: best.website ?? info.website,
        category: best.category ?? info.category,
      };
    }
    if (best.placeId && (best.address || best.phone)) break;
  }

  if (!best || (!best.placeId && !best.name && !best.address && !best.phone)) {
    return { placeId: null, name: null, address: null, phone: null, website: null, category: null, diagnostics };
  }
  return { ...best, diagnostics };
}

/** Backwards-compatible helper: just the Place ID. */
export async function scrapePlaceIdFromMapsPage(url: string, timeoutMs = 12000): Promise<string | null> {
  return (await scrapeMapsPage(url, timeoutMs))?.placeId ?? null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreCandidate(c: PlaceCandidate, input: ResolveInput, link: MapsLinkInfo | null, extraSignals: string[] = []): ScoredCandidate {
  let score = 0;
  const signals: string[] = [...extraSignals];
  if (extraSignals.includes('cid')) score += 100;
  if (extraSignals.includes('place_id')) score += 100;
  if (extraSignals.includes('cid-link')) score += 100;

  if (input.phone && phonesMatch(input.phone, c.phone)) {
    score += 55;
    signals.push('phone');
  }

  const pt = linkPoint(link);
  if (pt && c.lat !== null && c.lng !== null) {
    const d = distanceMeters(pt.lat, pt.lng, c.lat, c.lng);
    if (d <= 150) {
      score += 35;
      signals.push('location');
    } else if (d <= 1000) {
      score += 15;
      signals.push('nearby');
    }
  }

  const sim = Math.max(nameSimilarity(input.name, c.name), link?.name ? nameSimilarity(link.name, c.name) : 0);
  if (sim > 0) {
    score += Math.round(30 * sim);
    if (sim >= 0.6) signals.push('name');
  }
  const dIn = domainOf(input.website);
  const dC = domainOf(c.website);
  if (dIn && dC && dIn === dC) {
    score += 25;
    signals.push('website');
  }

  const pc = postalCode(input.address) ?? postalCode(input.city);
  if (pc && (c.address ?? '').includes(pc)) {
    score += 10;
    signals.push('postal');
  }

  // Exact name from the Maps link + right area is as good as it gets for a service-area business.
  if (link?.name && nameSimilarity(link.name, c.name) >= 0.95 && (signals.includes('location') || signals.includes('nearby') || signals.includes('postal'))) {
    score += 20;
    signals.push('link-name');
  }

  return { ...c, score, signals: Array.from(new Set(signals)) };
}

function confidenceFor(best: ScoredCandidate | null): Confidence {
  if (!best) return 'none';
  if (best.signals.includes('cid') || best.signals.includes('place_id') || best.signals.includes('cid-link')) return 'exact';
  if (best.score >= 65) return 'high';
  if (best.score >= 40) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

export type ResolveMode = 'auto' | 'free';

export interface ResolveOptions {
  /** 'free' = only expand the Maps link and read the page; never call the Google API. */
  mode?: ResolveMode;
}

export async function resolvePlace(input: ResolveInput, options: ResolveOptions = {}): Promise<ResolveResult> {
  const free = options.mode === 'free' || isGoogleApiDisabled();
  const pool = new Map<string, { c: PlaceCandidate; extra: string[] }>();
  const add = (c: PlaceCandidate, extra: string[] = []) => {
    if (!c.placeId) return;
    const prev = pool.get(c.placeId);
    if (prev) {
      prev.extra.push(...extra);
      // keep richer contact info
      prev.c.phone ??= c.phone;
      prev.c.website ??= c.website;
      prev.c.lat ??= c.lat;
      prev.c.lng ??= c.lng;
    } else pool.set(c.placeId, { c: { ...c }, extra: [...extra] });
  };

  const errors: string[] = [];
  let link: MapsLinkInfo | null = null;
  let pageInfo: MapsPageInfo | null = null;

  // 1. Maps link -------------------------------------------------------------
  if (input.mapsUrl) {
    link = await expandMapsUrl(input.mapsUrl);
    if (link.placeId) {
      add({ placeId: link.placeId, name: link.name ?? input.name, address: null, phone: null, website: null, businessStatus: null, lat: link.lat, lng: link.lng, types: [] }, ['place_id']);
    }
    if (!link.finalUrl && !link.placeId && !link.cid) errors.push('maps link: could not be expanded (no redirect / blocked)');

    // 2. Free path first: read the Maps page itself (no API call) ------------
    if (pool.size === 0) {
      const pageUrl = link.finalUrl ?? (link.cid ? `https://www.google.com/maps?cid=${link.cid}` : input.mapsUrl);
      const page = await scrapeMapsPage(pageUrl, 12000, link.cid);
      // Keep whatever contact details the page offered, even without a Place ID.
      if (page && (page.address || page.phone || page.category || page.website)) pageInfo = page;
      if (page?.placeId) {
        add(
          {
            placeId: page.placeId,
            name: page.name ?? link.name ?? input.name,
            address: page.address,
            phone: page.phone,
            website: page.website,
            businessStatus: null,
            lat: link.lat,
            lng: link.lng,
            types: page.category ? [page.category] : [],
          },
          ['place_id', 'maps-page'],
        );
      } else {
        errors.push('maps page: no place id found in page');
        if (page?.name && !link.name) link.name = page.name;
      }
    }

    // 3. CID lookup via the (legacy) Places API — 1 call, exact ---------------
    if (pool.size === 0 && link.cid && !free) {
      try {
        const byCid = await fetchPlaceByCidLegacy(link.cid);
        if (byCid) add(byCid, ['cid']);
        else errors.push(`cid ${link.cid}: no result from Places API (legacy "Places API" may be disabled for this key)`);
      } catch (err) {
        errors.push(`cid lookup: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 4. Searches (skip when we already have an exact hit) -------------------
  const hasExact = Array.from(pool.values()).some((p) => p.extra.includes('cid') || p.extra.includes('place_id'));
  const tried: string[] = [];
  if (free && !hasExact) {
    errors.push(input.mapsUrl ? 'URL-only mode: page gave no Place ID (Google API not used)' : 'URL-only mode: this row has no Maps link');
  }
  if (!hasExact && !free) {
    const pt = linkPoint(link);
    // Service-area businesses hide their address, so bias generously and retry without bias.
    const bias = pt ? { lat: pt.lat, lng: pt.lng, radiusM: 2000 } : undefined;
    const where = input.address?.trim() || input.city?.trim() || '';
    const queries: string[] = [];
    if (input.phone && phoneDigits(input.phone).length >= 7) queries.push(toE164(input.phone, input.address));
    if (link?.name) queries.push(`${link.name}${where ? `, ${where}` : ''}`);
    queries.push(`${input.name}${where ? `, ${where}` : ''}`);
    if (link?.name && link.name !== input.name) queries.push(link.name);
    else if (where) queries.push(input.name);

    for (const q of Array.from(new Set(queries))) {
      tried.push(q);
      try {
        let results = await searchPlaces(q, { locationBias: bias, limit: 5 });
        if (results.length === 0 && bias) results = await searchPlaces(q, { limit: 5 });
        results.forEach((r) => add(r));
      } catch (err) {
        errors.push(`search "${q.slice(0, 40)}": ${err instanceof Error ? err.message : String(err)}`);
        if (/denied/i.test(String(err))) break;
      }
      // Stop early once something clearly matches.
      const top = Array.from(pool.values())
        .map(({ c, extra }) => scoreCandidate(c, input, link, extra))
        .sort((a, b) => b.score - a.score)[0];
      if (top && top.score >= 65) break;
    }
  }

  // 5. Still nothing but the link carries a CID → monitor by CID. The first
  //    status check (Place Details by cid) fills in the real Place ID.
  if (pool.size === 0 && link?.cid) {
    add(
      {
        placeId: `cid:${link.cid}`,
        name: pageInfo?.name ?? link.name ?? input.name,
        address: pageInfo?.address ?? null,
        phone: pageInfo?.phone ?? null,
        website: pageInfo?.website ?? null,
        businessStatus: null,
        lat: link.lat,
        lng: link.lng,
        types: pageInfo?.category ? [pageInfo.category] : [],
      },
      ['cid-link'],
    );
    // A CID from the link is an exact identity; drop the "not found" noise.
    for (let i = errors.length - 1; i >= 0; i--) if (/maps page: no place id|URL-only mode/.test(errors[i])) errors.splice(i, 1);
  }

  const candidates = Array.from(pool.values())
    .map(({ c, extra }) => scoreCandidate(c, input, link, extra))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const best = candidates[0] ?? null;
  return {
    candidates,
    best,
    confidence: confidenceFor(best),
    mapsLink: link,
    queries: tried,
    error: errors.length ? errors.join(' | ') : null,
  };
}

/** Resolve many rows with limited concurrency. Never throws; per-row errors are reported. */
export async function resolveMany(inputs: ResolveInput[], concurrency = 4, options: ResolveOptions = {}): Promise<ResolveResult[]> {
  const out: ResolveResult[] = new Array(inputs.length);
  let next = 0;
  const worker = async () => {
    while (next < inputs.length) {
      const i = next++;
      try {
        out[i] = await resolvePlace(inputs[i], options);
      } catch (err) {
        out[i] = { candidates: [], best: null, confidence: 'none', mapsLink: null, queries: [], error: err instanceof Error ? err.message : String(err) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, worker));
  return out;
}
