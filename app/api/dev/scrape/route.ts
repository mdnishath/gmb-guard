import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, handleRouteError, jsonOk, parseSearchParams } from '@/lib/api-utils';
import { checkPlaceViaMapsPage, mapsCheckVariants } from '@/lib/maps-page-check';
import { expandMapsUrl, fetchMapsPageRaw, resolvePlace, scrapeMapsPage } from '@/lib/place-resolver';
import { requireAuth } from '@/lib/session';

/** Small, safe excerpts of the HTML so we can see what Google serves to the server. */
function excerpts(html: string, needles: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  out.head = html.slice(0, 1500);
  for (const n of needles) {
    if (!n) continue;
    const i = html.toLowerCase().indexOf(n.toLowerCase());
    out[`around:${n.slice(0, 30)}`] = i === -1 ? null : html.slice(Math.max(0, i - 200), i + 300);
  }
  out.titles = (html.match(/<title>[^<]*<\/title>/gi) ?? []).join(' | ') || null;
  out.metas = (html.match(/<meta[^>]+(?:og:|description|itemprop)[^>]*>/gi) ?? []).slice(0, 12).join('\n') || null;
  return out;
}

/**
 * GET /api/dev/scrape?url=https://maps.app.goo.gl/…   (admin)
 * Diagnostics for the no-API path: what the short link expands to, what the
 * Maps page returned, and what the resolver would produce in URL-only mode.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ url: z.string().url().max(1000) });

export async function GET(req: NextRequest) {
  try {
    requireAuth(req, 'ADMIN');
    enforceRateLimit(req, 'dev-scrape', 30, 60_000);
    const { url } = parseSearchParams(req.nextUrl.searchParams, schema);

    const link = await expandMapsUrl(url);
    const page = await scrapeMapsPage(link.finalUrl ?? url, 12000, link.cid);
    const resolved = await resolvePlace({ name: link.name ?? 'unknown', mapsUrl: url }, { mode: 'free' });
    const check = link.cid || link.placeId ? await checkPlaceViaMapsPage({ placeId: link.placeId ?? `cid:${link.cid}`, cid: link.cid, name: link.name }) : null;

    const htmlExcerpts: Array<Record<string, string | null>> = [];
    if (link.cid || link.placeId) {
      let cidHex = '';
      try {
        cidHex = link.cid ? BigInt(link.cid).toString(16) : '';
      } catch {
        cidHex = '';
      }
      for (const v of mapsCheckVariants({ placeId: link.placeId ?? `cid:${link.cid}`, cid: link.cid })) {
        const rawPage = await fetchMapsPageRaw(v.url, 12000, v.userAgent);
        htmlExcerpts.push(
          rawPage.html
            ? { variant: v.variant, url: v.url, status: String(rawPage.status), finalUrl: rawPage.finalUrl, bytes: String(rawPage.html.length), ...excerpts(rawPage.html, [link.name ?? '', cidHex ? `0x${cidHex}` : '', 'ChIJ', 'APP_INITIALIZATION_STATE']) }
            : { variant: v.variant, url: v.url, error: rawPage.error },
        );
      }
    }

    return jsonOk({
      input: url,
      link,
      page: page ? { placeId: page.placeId, name: page.name, address: page.address, phone: page.phone, website: page.website, category: page.category } : null,
      pageDiagnostics: page?.diagnostics ?? [],
      resolved: { confidence: resolved.confidence, best: resolved.best, error: resolved.error },
      statusCheck: check,
      htmlExcerpts,
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/dev/scrape');
  }
}
