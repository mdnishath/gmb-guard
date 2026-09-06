/**
 * Small heuristics to fill in city / category when the client's spreadsheet
 * does not have those columns.
 */

const COUNTRY_WORDS = /^(france|united states|usa|us|uk|united kingdom|england|deutschland|germany|espa[nñ]a|spain|italia|italy|canada|australia|bangladesh|india|belgique|belgium|suisse|switzerland|nederland|netherlands)$/i;

/** "5 Rue de Turenne, 75004 Paris, France" → "Paris"; "Paris, France" → "Paris"; "91170 Grigny, France" → "Grigny". */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const a = address.replace(/\s+/g, ' ').trim();
  if (!a) return null;

  // Postal code followed by the city (France, Germany, Spain, Italy, …).
  const pc = a.match(/\b\d{4,5}\s+([A-Za-zÀ-ÿ'’. -]+?)(?:\s*,|\s+(?:cedex|france|deutschland|germany|espa[nñ]a|italia)\b|$)/i);
  if (pc && pc[1].trim().length > 1) return tidy(pc[1]);

  // "City, ST 12345, USA" style: segment with a state code + zip.
  const us = a.match(/,\s*([A-Za-z .'-]+),\s*[A-Z]{2}\s+\d{5}/);
  if (us) return tidy(us[1]);

  const parts = a
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  // Drop a trailing country.
  if (parts.length > 1 && COUNTRY_WORDS.test(parts[parts.length - 1])) parts.pop();
  const last = parts[parts.length - 1];
  const cleaned = last.replace(/\b\d{3,}\b/g, '').replace(/\b[A-Z]{2}\b$/, '').trim();
  if (!cleaned || /^\d/.test(cleaned)) return null;
  // A lone street line ("5 Rue de Turenne") is not a city.
  if (parts.length === 1 && /^\d+\s/.test(cleaned)) return null;
  return tidy(cleaned);
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const TYPE_LABELS: Record<string, string> = {
  electrician: 'Electrician',
  plumber: 'Plumber',
  roofing_contractor: 'Roofing',
  general_contractor: 'Contractor',
  painter: 'Painter',
  locksmith: 'Locksmith',
  moving_company: 'Moving company',
  car_repair: 'Auto repair',
  car_dealer: 'Car dealer',
  car_wash: 'Car wash',
  dentist: 'Dentist',
  doctor: 'Doctor',
  physiotherapist: 'Physiotherapist',
  veterinary_care: 'Veterinarian',
  lawyer: 'Law firm',
  accounting: 'Accountant',
  insurance_agency: 'Insurance',
  real_estate_agency: 'Real estate',
  restaurant: 'Restaurant',
  cafe: 'Cafe',
  bakery: 'Bakery',
  bar: 'Bar',
  gym: 'Gym',
  hair_care: 'Hair salon',
  beauty_salon: 'Beauty salon',
  spa: 'Spa',
  florist: 'Florist',
  pharmacy: 'Pharmacy',
  hardware_store: 'Hardware store',
  furniture_store: 'Furniture store',
  clothing_store: 'Clothing store',
  jewelry_store: 'Jewelry store',
  electronics_store: 'Electronics store',
  grocery_or_supermarket: 'Grocery',
  supermarket: 'Supermarket',
  lodging: 'Hotel',
  travel_agency: 'Travel agency',
  school: 'School',
  church: 'Church',
  laundry: 'Laundry',
  storage: 'Storage',
  home_goods_store: 'Home goods',
  hvac_contractor: 'HVAC',
};

const GENERIC = new Set(['point_of_interest', 'establishment', 'store', 'health', 'finance', 'food', 'place_of_worship', 'premise', 'local_business']);

/** Keywords in a business name (EN / FR / ES / DE) → category. Used when Google gave us nothing. */
const NAME_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(electric|électric|electr|elect\b|électricien|electrician|electricista|elektrik)/i, 'Electrician'],
  [/\b(plomb|plumb|fontaner|klempner|sanitär)/i, 'Plumber'],
  [/\b(roof|toitur|couvreur|tejado|dach)/i, 'Roofing'],
  [/\b(hvac|clim|chauffag|heating|air cond|calefac)/i, 'HVAC'],
  [/\b(serrur|locksmith|cerrajer|schlüssel)/i, 'Locksmith'],
  [/\b(peintr|painter|pintor|maler)\b/i, 'Painter'],
  [/\b(menuis|carpent|charpent|carpinter|tischler)/i, 'Carpenter'],
  [/\b(maçon|mason|albañil|maurer)/i, 'Masonry'],
  [/\b(nettoyage|cleaning|limpieza|reinigung)/i, 'Cleaning'],
  [/\b(déménag|moving|mudanza|umzug)/i, 'Moving company'],
  [/\b(garage|auto|car repair|mécanicien|mecanic)/i, 'Auto repair'],
  [/\b(dentist|dentaire|dental|zahnarzt)/i, 'Dentist'],
  [/\b(avocat|lawyer|law firm|abogado|anwalt)/i, 'Law firm'],
  [/\b(comptab|accountant|contador|steuerberat)/i, 'Accountant'],
  [/\b(immobili|real estate|inmobiliaria|immobilien)/i, 'Real estate'],
  [/\b(restaurant|bistro|brasserie|pizzeria|kitchen)/i, 'Restaurant'],
  [/\b(coiffe|hair|salon|peluquer|friseur)/i, 'Hair salon'],
  [/\b(pharma|apothek|farmacia)/i, 'Pharmacy'],
  [/\b(boulang|bakery|panader|bäcker)/i, 'Bakery'],
  [/\b(jardin|garden|landscap|paysag)/i, 'Landscaping'],
  [/\b(rénov|renov|remodel|reform)/i, 'Renovation'],
  [/\b(construct|bâtiment|building|bau\b)/i, 'Contractor'],
];

export function categoryFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  // Strip accents so "Électricien" / "Rénovation" match the keyword list (\b does not work with accented letters).
  const plain = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [re, label] of NAME_KEYWORDS) if (re.test(plain) || re.test(name)) return label;
  return null;
}

/** Best category from Google types, then the page text, then the business name. */
export function bestCategory(types: string[] | null | undefined, name: string | null | undefined): string | null {
  return categoryFromTypes(types) ?? categoryFromName(name);
}

/** Google `types` → a readable category. */
export function categoryFromTypes(types: string[] | null | undefined): string | null {
  if (!types?.length) return null;
  for (const t of types) if (TYPE_LABELS[t]) return TYPE_LABELS[t];
  const first = types.find((t) => !GENERIC.has(t));
  if (!first) return null;
  // Already human text (scraped from the Maps page)? Keep it as-is.
  if (/\s/.test(first) || /[A-Z]/.test(first)) return first.trim();
  return first.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
