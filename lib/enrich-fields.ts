/** Fields the "Enrich from Google" action can copy from a listing's real Google profile. */
export const ENRICH_FIELDS = ['phone', 'category', 'address', 'city', 'website', 'name'] as const;
export type EnrichField = (typeof ENRICH_FIELDS)[number];

export const ENRICH_FIELD_LABELS: Record<EnrichField, string> = {
  phone: 'Phone number',
  category: 'Category',
  address: 'Address',
  city: 'City',
  website: 'Website',
  name: 'Business name',
};
