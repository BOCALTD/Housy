// Sorting lists from the address (?sort=name&dir=asc), so a sorted, searched list can be bookmarked, shared and reloaded.
export type Dir = "asc" | "desc";
export type SortOption = { key: string; label: string; dir: Dir };
export type Sort = { key: string; dir: Dir };
type Params = { [key: string]: string | string[] | undefined } | undefined;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The sort asked for, if it is one of the options; otherwise the first option with its usual direction. */
export function readSort(params: Params, options: SortOption[]): Sort {
  const key = one(params?.sort), dir = one(params?.dir);
  const o = options.find((x) => x.key === key) ?? options[0];
  return { key: o.key, dir: dir === "asc" || dir === "desc" ? dir : o.dir };
}

/** The address with some values changed (empty removes them); the page number resets unless it is given. */
export function withParams(path: string, params: Params, change: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (["notice", "error", "warning", "undo", "page"].includes(k)) continue;
    const s = one(v);
    if (s) u.set(k, s);
  }
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined || v === "") u.delete(k); else u.set(k, String(v));
  }
  const q = u.toString();
  return q ? `${path}?${q}` : path;
}

/** Compare two values for sorting: text by the reader's alphabet (ignoring case), numbers and dates by size, empty last. */
export function compare(a: unknown, b: unknown, dir: Dir) {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  let r: number;
  if (a instanceof Date && b instanceof Date) r = a.getTime() - b.getTime();
  else if (typeof a === "number" && typeof b === "number") r = a - b;
  else if (typeof a === "bigint" && typeof b === "bigint") r = a < b ? -1 : a > b ? 1 : 0;
  else r = String(a).localeCompare(String(b), "en", { sensitivity: "base", numeric: true });
  return dir === "asc" ? r : -r;
}

/** Sort a copy of a list by one of its values. */
export function sortBy<T>(rows: T[], value: (row: T) => unknown, dir: Dir) {
  return [...rows].sort((x, y) => compare(value(x), value(y), dir));
}
