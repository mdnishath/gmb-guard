import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { alertLogs, auditLogs, listings } from '@/lib/db';
import { ApiError, handleRouteError, jsonOk, parseJsonBody } from '@/lib/api-utils';
import { placeIdSchema } from '@/lib/listing-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.string().trim().min(1, 'id is required').max(64);

// ---------------------------------------------------------------------------
// GET /api/listings/:id  → listing + status history + alert deliveries (for the drawer)
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const id = idSchema.parse((await ctx.params).id);
    const listing = listings.getById(id);
    if (!listing) throw new ApiError(404, 'Listing not found');

    const history = auditLogs.forListing(id, 50);
    const alerts = alertLogs.list({ listingId: id, page: 1, pageSize: 30 }).items;

    return jsonOk({ listing: listings.toPublic(listing), history, alerts });
  } catch (err) {
    return handleRouteError(err, 'GET /api/listings/[id]');
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/listings/:id  { name?, cid?, address?, city?, category?, phone?, website?, tag?, notes?,
//                            accountEmail?, accountPassword?, totpSecret?, monitoringEnabled? }
// Secrets: omit = unchanged, "" or null = clear, string = replace.
// ---------------------------------------------------------------------------

const nullableText = (max: number) =>
  z.preprocess((v) => (v === '' ? null : typeof v === 'string' ? v.trim() : v), z.string().max(max).nullable()).optional();

const updateListingSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    // Changing the identifier re-points monitoring at another Google listing.
    placeId: placeIdSchema.optional(),
    cid: z
      .preprocess((v) => (v === '' ? null : typeof v === 'string' ? v.trim() : v), z.string().regex(/^\d{1,25}$/, 'cid must be a numeric Google CID').nullable())
      .optional(),
    address: nullableText(300),
    city: nullableText(120),
    category: nullableText(120),
    phone: nullableText(40),
    website: nullableText(300),
    sourceUrl: nullableText(1000),
    tag: nullableText(60),
    notes: nullableText(5000),
    accountEmail: nullableText(200),
    accountPassword: nullableText(200),
    totpSecret: z
      .preprocess(
        (v) => (v === '' || v === null ? null : typeof v === 'string' ? v.replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase() : v),
        z.string().regex(/^[A-Z2-7]{16,128}$/, 'TOTP secret must be base32 (letters A–Z and digits 2–7)').nullable(),
      )
      .optional(),
    monitoringEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const id = idSchema.parse((await ctx.params).id);
    const input = await parseJsonBody(req, updateListingSchema);

    const { placeId, ...rest } = input;
    if (placeId) {
      const current = listings.getById(id);
      if (!current) throw new ApiError(404, 'Listing not found');
      if (placeId !== current.placeId) {
        // New identifier → the stored status is about a different listing now.
        listings.updatePlaceId(id, placeId);
        listings.resetVerification(id);
      }
    }
    const listing = listings.update(id, rest);
    if (!listing) throw new ApiError(404, 'Listing not found');

    return jsonOk({ listing: listings.toPublic(listing) });
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/listings/[id]');
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/listings/:id  → removes the listing and (via cascade) its audit logs
// ---------------------------------------------------------------------------

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const id = idSchema.parse((await ctx.params).id);
    const deleted = listings.remove(id);
    if (!deleted) throw new ApiError(404, 'Listing not found');

    return jsonOk({ deleted: { id: deleted.id, name: deleted.name, placeId: deleted.placeId } });
  } catch (err) {
    return handleRouteError(err, 'DELETE /api/listings/[id]');
  }
}
