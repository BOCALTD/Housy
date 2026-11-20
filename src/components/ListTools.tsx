import Link from "next/link";
import { withParams, type Sort, type SortOption } from "@/lib/list-sort";

type Params = { [key: string]: string | string[] | undefined } | undefined;

const arrow = (dir: "asc" | "desc") => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {dir === "asc" ? <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></> : <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>}
  </svg>
);
const sortIcon = <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16" /><path d="m3 8 4-4 4 4" /><path d="M17 20V4" /><path d="m13 16 4 4 4-4" /></svg>;

/**
 * Search and sort for a list: a search box, "Sort by" with the options, and a button that flips the order (with an arrow showing
 * which way it runs). Works without scripts (a plain form); other filters on the page are kept.
 */
export function ListTools({ path, params, q, placeholder, label, options, sort, keep = [], children }: {
  path: string; params: Params; q?: string; placeholder?: string; label: string; options: SortOption[]; sort: Sort; keep?: string[]; children?: React.ReactNode;
}) {
  const other = sort.dir === "asc" ? "desc" : "asc";
  const one = (k: string) => { const v = params?.[k]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
  return (
    <form className="list-tools" role="search" action={path} aria-label={label}>
      {keep.filter((k) => one(k)).map((k) => <input key={k} type="hidden" name={k} value={one(k)} />)}
      {placeholder !== undefined ? (
        <label className="list-tools-search">
          <span className="sr-only">{label}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" name="q" defaultValue={q} placeholder={placeholder} enterKeyHint="search" maxLength={120} />
        </label>
      ) : null}
      {children}
      <label className="list-tools-sort">
        {sortIcon}<span className="sr-only">Sort by</span>
        <select name="sort" defaultValue={sort.key} aria-label="Sort by">{options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
      </label>
      <input type="hidden" name="dir" value={sort.dir} />
      <button className="btn" type="submit">{placeholder !== undefined ? "Search" : "Sort"}</button>
      <Link className="btn list-tools-dir" href={withParams(path, params, { sort: sort.key, dir: other })} aria-label={`Order: ${sort.dir === "asc" ? "ascending" : "descending"}. Switch to ${other === "asc" ? "ascending" : "descending"}`} title="Reverse the order">{arrow(sort.dir)}</Link>
      {q ? <Link className="btn list-tools-clear" href={withParams(path, params, { q: "" })}>Clear search</Link> : null}
    </form>
  );
}

/** A table heading that sorts by its column: tap to sort, tap again to reverse. Shows an arrow on the sorted column. */
export function SortTh({ path, params, sort, k, children, dir = "asc", className }: { path: string; params: Params; sort: Sort; k: string; children: React.ReactNode; dir?: "asc" | "desc"; className?: string }) {
  const active = sort.key === k;
  const next = active ? (sort.dir === "asc" ? "desc" : "asc") : dir;
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} scope="col">
      <Link className={`sort-th${active ? " on" : ""}`} href={withParams(path, params, { sort: k, dir: next })}>
        {children}<span className="sort-th-icon">{active ? arrow(sort.dir) : sortIcon}</span>
      </Link>
    </th>
  );
}
