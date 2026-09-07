import { CID_PREFIX, isCidPlaceId, type PlaceCheckOutcome, type PlaceDetailsResponse } from './google-places';
import { fetchMapsPageRaw, nameSimilarity, parseMapsPageHtml } from './place-resolver';

/**
 * Status check WITHOUT the Places API.
 *
 * Google serves several flavours of a place page; the server-side HTML of the
 * normal page is often a JavaScript shell, so we try a few variants (normal page,
 * Googlebot user-agent, the light "embed" page, place_id redirect) and accept the
 * first one that proves the business exists:
 *
 *   <title> / og:title carries a business name       → exists
 *   page data contains the CID signature 0x…:0x<hex> → exists
 *   page data contains OUR listing name              → exists
 *   Google redirected to /maps/place/<name>/         → exists
 *
 * IMPORTANT: finding nothing is NOT treated as a suspension. Google serves a
 * script-only shell to server-side requests, so "no name in the HTML" usually
 * means we could not read the page, not that the listing is gone. Such a check
 * returns INCONCLUSIVE and leaves the stored status untouched. The only
 * negative verdict this check can give is when the page clearly shows a
 * DIFFERENT business (the id was merged/replaced) → SUSPENDED.
 * "Permanently / temporarily closed" in the page meta → CLOSED (best-effort).
 */

export interface MapsPageCheckInfo {
  source: 'maps-page';
  url: string;
  variant: string;
  finalUrl: string | null;
  httpStatus: number | null;
  title: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  pageName: string | null;
  signals: string[];
  closedPermanently: boolean;
  closedTemporarily: boolean;
  tried: Array<{ variant: string; status: number | null; bytes: number; title: string | null; signals: string[]; error: string | null }>;
  checkedAt: string;
}

const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/** "Argen Électricien Confort Électrique - Google Maps" → "Argen Électricien Confort Électrique"; "Google Maps" → null. */
export function businessNameFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.replace(/\s+/g, ' ').trim();
  if (/^google maps$/i.test(t)) return null;
  const name = t.replace(/\s*[-–—·|]\s*google maps\s*$/i, '').trim();
  if (!name || /^google maps$/i.test(name)) return null;
  return name;
}

function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cidOf(id: { placeId: string; cid: string | null }): string | null {
  return id.cid ?? (isCidPlaceId(id.placeId) ? id.placeId.slice(CID_PREFIX.length) : null);
}

export function mapsCheckUrl(id: { placeId: string; cid: string | null }): string {
  const cid = cidOf(id);
  if (cid) return `https://www.google.com/maps?cid=${encodeURIComponent(cid)}&hl=en`;
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id.placeId)}&hl=en`;
}

/** All the ways we can ask Google for this listing, most promising first. */
export function mapsCheckVariants(id: { placeId: string; cid: string | null }): Array<{ variant: string; url: string; userAgent?: string }> {
  const cid = cidOf(id);
  const out: Array<{ variant: string; url: string; userAgent?: string }> = [];
  if (cid) {
    out.push({ variant: 'maps?cid', url: `https://www.google.com/maps?cid=${cid}&hl=en` });
    out.push({ variant: 'embed', url: `https://maps.google.com/maps?cid=${cid}&hl=en&output=embed` });
    out.push({ variant: 'googlebot', url: `https://www.google.com/maps?cid=${cid}&hl=en`, userAgent: GOOGLEBOT_UA });
  }
  if (!isCidPlaceId(id.placeId)) {
    out.push({ variant: 'place_id', url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id.placeId)}&hl=en` });
    out.push({ variant: 'place_id-embed', url: `https://maps.google.com/maps?q=place_id:${encodeURIComponent(id.placeId)}&hl=en&output=embed` });
  }
  return out;
}

interface Evaluation {
  pageName: string | null;
  signals: string[];
  sameBusiness: boolean;
  similarity: number;
  closedPermanently: boolean;
  closedTemporarily: boolean;
  title: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  consentPage: boolean;
  placeId: string | null;
}

const STOP = new Set(['test', 'the', 'and', 'des', 'les', 'services', 'service', 'solutions', 'company', 'inc', 'llc', 'sarl', 'google', 'maps']);

function evaluate(html: string, finalUrl: string | null, id: { placeId: string; cid: string | null; name?: string | null }): Evaluation {
  const p = parseMapsPageHtml(html);
  const signals: string[] = [];

  // 1. name in title / og:title
  const pageName = businessNameFromTitle(p.title) ?? businessNameFromTitle(p.ogTitle) ?? (p.ogTitle && !/^google maps$/i.test(p.ogTitle) ? p.ogTitle.split(' · ')[0].trim() : null);
  if (pageName) signals.push(`title "${pageName}"`);

  // 2. redirect to the place page
  const placeUrlMatch = (finalUrl ?? '').match(/\/maps\/place\/([^/?#]+)/);
  if (placeUrlMatch) signals.push('place url');

  // 3. CID signature in page data
  const cid = cidOf(id);
  let cidHex: string | null = null;
  try {
    cidHex = cid ? BigInt(cid).toString(16) : null;
  } catch {
    cidHex = null;
  }
  if (cidHex && new RegExp(`0x[0-9a-f]{6,}:0x${cidHex}(?![0-9a-f])`, 'i').test(html)) signals.push('cid signature');

  // 4. our listing name in page data
  const expected = id.name?.trim() ?? '';
  const expectedNorm = normalizeForMatch(expected);
  if (expectedNorm) {
    const pageText = normalizeForMatch(html);
    const words = expectedNorm.split(' ').filter((w) => w.length >= 4 && !STOP.has(w));
    const phraseOk = (expectedNorm.includes(' ') || expectedNorm.length >= 8) && words.length >= 1 && pageText.includes(expectedNorm);
    const wordsOk = words.length >= 2 && words.every((w) => pageText.includes(w));
    if (phraseOk || wordsOk) signals.push('name in page data');
  }

  // Name shown by Google must roughly be ours.
  const shown = pageName ?? (placeUrlMatch ? decodeURIComponent(placeUrlMatch[1].replace(/\+/g, ' ')) : null);
  const similarity = shown && expected ? nameSimilarity(expected, shown) : 1;
  const sameBusiness = !shown || !expected || similarity >= 0.3 || normalizeForMatch(shown).includes(expectedNorm) || expectedNorm.includes(normalizeForMatch(shown));

  const metaText = `${p.ogTitle ?? ''} ${p.ogDescription ?? ''} ${p.title ?? ''}`;
  return {
    pageName: shown,
    signals,
    sameBusiness,
    similarity,
    closedPermanently: /permanently closed|définitivement fermé|fermé définitivement/i.test(metaText),
    closedTemporarily: /temporarily closed|temporairement fermé|fermé temporairement/i.test(metaText),
    title: p.title,
    ogTitle: p.ogTitle,
    ogDescription: p.ogDescription,
    consentPage: p.consentPage,
    placeId: p.placeId,
  };
}

export async function checkPlaceViaMapsPage(id: { placeId: string; cid: string | null; name?: string | null }, timeoutMs = 15000): Promise<PlaceCheckOutcome> {
  const variants = mapsCheckVariants(id);
  const tried: MapsPageCheckInfo['tried'] = [];
  let blocked: string | null = null;
  let consent = false;
  let found: { v: (typeof variants)[number]; finalUrl: string | null; status: number | null; ev: Evaluation } | null = null;
  let last: { v: (typeof variants)[number]; finalUrl: string | null; status: number | null; ev: Evaluation } | null = null;

  for (const v of variants) {
    const { html, status, finalUrl, error } = await fetchMapsPageRaw(v.url, timeoutMs, v.userAgent);
    if (error || !html || status === null) {
      tried.push({ variant: v.variant, status, bytes: 0, title: null, signals: [], error: error ?? `HTTP ${status ?? 'error'}` });
      continue;
    }
    if (status === 429 || status === 403 || status === 503) {
      blocked = `HTTP ${status}`;
      tried.push({ variant: v.variant, status, bytes: html.length, title: null, signals: [], error: `blocked (${status})` });
      continue;
    }
    if (status >= 400) {
      tried.push({ variant: v.variant, status, bytes: html.length, title: null, signals: [], error: `HTTP ${status}` });
      continue;
    }
    const ev = evaluate(html, finalUrl, id);
    tried.push({ variant: v.variant, status, bytes: html.length, title: ev.title, signals: ev.signals, error: ev.consentPage ? 'consent page' : null });
    if (ev.consentPage) {
      consent = true;
      continue;
    }
    last = { v, finalUrl, status, ev };
    if (ev.signals.length > 0) {
      found = last;
      break;
    }
  }

  const url = mapsCheckUrl(id);
  console.info(`[maps-page-check] ${url} → ${found ? 'FOUND' : 'NOT FOUND'} ${JSON.stringify(tried)}`);

  if (!found && !last) {
    // Every variant failed technically → inconclusive, keep the old status.
    const reason = blocked ? `Maps page: blocked by Google (${blocked}) — slow down or switch to API checks` : consent ? 'Maps page: Google consent page returned (cannot read listing)' : `Maps page: ${tried.map((t) => `${t.variant}: ${t.error}`).join('; ')}`;
    return { ok: false, reason, googleStatus: null, raw: { source: 'maps-page', url, tried } };
  }

  const hit = found ?? last!;
  const ev = hit.ev;
  const info: MapsPageCheckInfo = {
    source: 'maps-page',
    url,
    variant: hit.v.variant,
    finalUrl: hit.finalUrl,
    httpStatus: hit.status,
    title: ev.title,
    ogTitle: ev.ogTitle,
    ogDescription: ev.ogDescription,
    pageName: ev.pageName,
    signals: ev.signals,
    closedPermanently: ev.closedPermanently,
    closedTemporarily: ev.closedTemporarily,
    tried,
    checkedAt: new Date().toISOString(),
  };

  const exists = Boolean(found) && ev.sameBusiness;
  const expected = id.name?.trim() ?? '';

  if (!exists) {
    // A page WITHOUT the business is not proof that the listing is gone: Google
    // serves a JavaScript shell to server-side requests, so "no name found" is
    // usually our own blindness, not a suspension. The only safe negative is a
    // page that clearly shows a DIFFERENT business (the id was merged/replaced).
    if (found && !ev.sameBusiness) {
      const detail = `Not found — this id now shows a different business: "${ev.pageName}" (expected "${expected}")`;
      const raw: PlaceDetailsResponse & { mapsPage: MapsPageCheckInfo } = { status: 'NOT_FOUND', error_message: detail, mapsPage: info };
      return { ok: true, status: 'SUSPENDED', googleStatus: 'NOT_FOUND', businessStatus: null, googleName: null, resolvedPlaceId: null, raw, detail };
    }
    // Inconclusive → leave the stored status untouched and say why.
    const reason = `Maps page could not confirm "${expected}" (Google served a script-only page: ${tried
      .map((t) => `${t.variant}: ${t.bytes} bytes${t.error ? `, ${t.error}` : ''}`)
      .join('; ')}). Status left unchanged — use API checks for a definitive answer.`;
    return { ok: false, reason, googleStatus: null, raw: { source: 'maps-page', url, tried } };
  }

  const businessStatus = ev.closedPermanently ? 'CLOSED_PERMANENTLY' : ev.closedTemporarily ? 'CLOSED_TEMPORARILY' : 'OPERATIONAL';
  const detail = `Live — ${ev.signals.join(', ')} (via ${hit.v.variant})${businessStatus === 'OPERATIONAL' ? '' : ` — marked ${businessStatus.replace('_', ' ').toLowerCase()}`}`;
  const raw: PlaceDetailsResponse & { mapsPage: MapsPageCheckInfo } = {
    status: 'OK',
    result: { name: ev.pageName ?? undefined, business_status: businessStatus, place_id: ev.placeId ?? undefined },
    mapsPage: info,
  };
  return {
    ok: true,
    status: businessStatus === 'OPERATIONAL' ? 'ACTIVE' : 'CLOSED',
    googleStatus: 'OK',
    businessStatus,
    googleName: ev.pageName,
    resolvedPlaceId: ev.placeId,
    raw,
    detail,
  };
}
