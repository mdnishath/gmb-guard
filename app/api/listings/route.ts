import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { LISTING_SORT_FIELDS, LISTING_STATUSES, listings } from '@/lib/db';
import { handleRouteError, jsonOk, pagination, parseJsonBody, parseSearchParams } from '@/lib/api-utils';
import { checkListing, type ListingCheckResult } from '@/lib/gmb-checker';
import { categoryFromName, cityFromAddress } from '@/lib/derive';
import { listingFieldsSchema } from '@/lib/listing-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

// ---------------------------------------------------------------------------
// GET /api/listings?page=1&pageSize=25&search=roofing&status=SUSPENDED&city=&category=&pending=true&sortBy=name&sortDir=asc
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  city: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  pending: boolParam,
  hasError: boolParam,
  monitoringEnabled: boolParam,
  sortBy: z.enum(LISTING_SORT_FIELDS).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export async function GET(req: NextRequest) {
  try {
    const query = parseSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const { items, total } = listings.list(query);

    return jsonOk({
      items: items.map(listings.toPublic),
      pagination: pagination(query.page, query.pageSize, total),
      filters: {
        search: query.search ?? null,
        status: query.status ?? null,
        city: query.city ?? null,
        category: query.category ?? null,
        pending: query.pending ?? null,
        hasError: query.hasError ?? null,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/listings');
  }
}

// ---------------------------------------------------------------------------
// POST /api/listings   { name, placeId, cid?, address?, city?, category?, tag?, notes?, checkImmediately? }
// ---------------------------------------------------------------------------

const createListingSchema = listingFieldsSchema.extend({
  /** Run a Google check right away so the row is created with a real status. Default true. */
  checkImmediately: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  try {
    const { checkImmediately, ...fields } = await parseJsonBody(req, createListingSchema);
    if (!fields.city) fields.city = cityFromAddress(fields.address) ?? undefined;
    if (!fields.category) fields.category = categoryFromName(fields.name) ?? undefined;

    const created = listings.create(fields);

    let initialCheck: ListingCheckResult | null = null;
    if (checkImmediately) {
      try {
        initialCheck = await checkListing(created);
      } catch (err) {
        // The listing exists; the cron will pick it up. Don't fail the request.
        console.error(`[POST /api/listings] initial check failed for ${created.id}:`, err);
      }
    }

    // Re-read so the client receives the post-check status / lastCheckedAt.
    const listing = initialCheck ? listings.getById(created.id) ?? created : created;

    return jsonOk({ listing: listings.toPublic(listing), initialCheck }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, 'POST /api/listings');
  }
}
