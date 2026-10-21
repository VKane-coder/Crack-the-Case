// Case library filters (docs/architecture.md §2.1): parsed from the URL on the server and the API,
// and written back to the URL by the filter bar. Unknown or malformed values are dropped, not errors.

export const PAGE_SIZE = 12;

/** Station length buckets, by the station clock (reading time not included). */
export const LENGTHS = {
  short: { label: "Under 8 min", min: 0, max: 479 },
  standard: { label: "8 min", min: 480, max: 539 },
  long: { label: "9 min or more", min: 540, max: null },
} as const;
export type LengthKey = keyof typeof LENGTHS;

export type CaseFilters = {
  q?: string;
  specialty?: string;
  difficulty?: number;
  length?: LengthKey;
  page: number;
};

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function get(params: Params, key: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

export function parseFilters(params: Params): CaseFilters {
  const q = get(params, "q")?.slice(0, 100);
  const specialty = get(params, "specialty");
  const difficulty = Number(get(params, "difficulty"));
  const length = get(params, "length");
  const page = Number(get(params, "page"));
  return {
    q: q && searchTerms(q).length ? q : undefined,
    specialty: specialty && /^[a-z0-9-]{1,60}$/.test(specialty) ? specialty : undefined,
    difficulty: Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5 ? difficulty : undefined,
    length: length && length in LENGTHS ? (length as LengthKey) : undefined,
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/** The URL query for a set of filters (page 1 and empty filters are left out). */
export function filtersToQuery(f: Partial<CaseFilters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.specialty) p.set("specialty", f.specialty);
  if (f.difficulty) p.set("difficulty", String(f.difficulty));
  if (f.length) p.set("length", f.length);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Words from a search box, reduced to letters and digits (safe to put in a tsquery). */
export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
}

/** Prefix-matching tsquery: "palp chest" → "palp:* & chest:*", so partly typed words still match. */
export function toPrefixTsquery(q: string): string {
  return searchTerms(q)
    .map((t) => `${t}:*`)
    .join(" & ");
}

export function hasFilters(f: CaseFilters) {
  return Boolean(f.q || f.specialty || f.difficulty || f.length);
}
