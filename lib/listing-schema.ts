import { z } from 'zod';

/** Shared validation for creating / importing listings. */

const optionalText = (max: number) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : String(v).trim()), z.string().max(max).optional());

/** Google CIDs are unsigned 64-bit integers: 1–20 digits, at most 18446744073709551615. */
export const MAX_CID = 18446744073709551615n;

export function isValidCid(value: string): boolean {
  if (!/^\d{1,20}$/.test(value)) return false;
  try {
    return BigInt(value) <= MAX_CID && BigInt(value) > 0n;
  } catch {
    return false;
  }
}

/** Accepts "", null, undefined or a number and normalises to a trimmed string | undefined. */
export const cidSchema = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : String(v).trim()),
  z.string().refine(isValidCid, 'cid must be a valid Google CID (up to 20 digits)').optional(),
);

/** A Google Place ID (ChIJ…) or, for listings imported from a Maps link, "cid:<number>". */
export const placeIdSchema = z
  .string()
  .trim()
  .min(9, 'placeId looks too short')
  .max(300)
  .regex(/^(?:cid:\d{1,20}|[A-Za-z0-9_-]{10,})$/, 'placeId must be a Google Place ID or cid:<number>')
  .refine((v) => !v.startsWith('cid:') || isValidCid(v.slice(4)), 'cid is not a valid Google CID (too large)');

export const listingFieldsSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  placeId: placeIdSchema,
  cid: cidSchema,
  address: optionalText(300),
  city: optionalText(120),
  category: optionalText(120),
  phone: optionalText(40),
  website: optionalText(300),
  tag: optionalText(60),
  notes: optionalText(5000),
  accountEmail: optionalText(200),
  accountPassword: optionalText(200),
  totpSecret: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : String(v).replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase()),
    z.string().regex(/^[A-Z2-7]{16,128}$/, 'TOTP secret must be base32 (letters A–Z and digits 2–7)').optional(),
  ),
});

export type ListingFields = z.infer<typeof listingFieldsSchema>;

/** A row to be matched against Google (no Place ID yet). */
export const resolveRowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: optionalText(40),
  address: optionalText(300),
  city: optionalText(120),
  website: optionalText(300),
  category: optionalText(120),
});

export type ResolveRow = z.infer<typeof resolveRowSchema>;
