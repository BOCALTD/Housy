import Link from "next/link";
import { humanize, tone } from "@/lib/labels";

export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${tone(status)}`}>{label ?? humanize(status)}</span>;
}

/** Shows ?error= and ?notice= messages set by server actions. */
export function Flash({ searchParams }: { searchParams?: { error?: string; notice?: string } }) {
  if (searchParams?.error) return <div className="flash error" role="alert">{searchParams.error}</div>;
  if (searchParams?.notice) return <div className="flash notice" role="status">{searchParams.notice}</div>;
  return null;
}

export function HouseIcon() {
  return (
    <svg viewBox="0 0 120 80" fill="none" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 40 60 8l50 32M20 36v36h80V36M48 72V48h24v24" />
    </svg>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function EnumOptions({ values }: { values: readonly string[] }) {
  return <>{values.map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</>;
}

export type SP = { [key: string]: string | string[] | undefined };

export function sp(searchParams: SP | undefined, key: string): string | undefined {
  const v = searchParams?.[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Show the first few items and fold the rest behind a "Show more" control, so long lists never stretch the page. */
export function ShowMore({ items, limit = 5, noun = "more" }: { items: React.ReactNode[]; limit?: number; noun?: string }) {
  const head = items.slice(0, limit);
  const rest = items.slice(limit);
  return (
    <>
      <ul className="timeline">{head}</ul>
      {rest.length > 0 ? (
        <details className="inline">
          <summary>Show {rest.length} {noun}</summary>
          <ul className="timeline">{rest}</ul>
        </details>
      ) : null}
    </>
  );
}

/** A table that shows the first rows and folds the rest behind "Show more", with the same column headings. */
export function TableMore({ head, rows, limit = 10, noun = "more rows" }: { head: React.ReactNode; rows: React.ReactNode[]; limit?: number; noun?: string }) {
  const first = rows.slice(0, limit);
  const rest = rows.slice(limit);
  return (
    <>
      <div className="table-wrap"><table><thead>{head}</thead><tbody>{first}</tbody></table></div>
      {rest.length > 0 ? (
        <details className="inline">
          <summary>Show {rest.length} {noun}</summary>
          <div className="table-wrap"><table><thead>{head}</thead><tbody>{rest}</tbody></table></div>
        </details>
      ) : null}
    </>
  );
}

/** Previous and Next for a long list, with where you are. `href` builds the link for a page number (0 is the first). */
export function Pager({ page, total, pageSize, href, noun = "items" }: { page: number; total: number; pageSize: number; href: (page: number) => string; noun?: string }) {
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  if (total <= pageSize) return null;
  const from = page * pageSize + 1, to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav className="row between" aria-label="Pages" style={{ padding: "8px 4px" }}>
      {page > 0 ? <Link className="btn" href={href(page - 1)} rel="prev">Previous</Link> : <span />}
      <span className="small muted">{from}–{to} of {total} {noun}</span>
      {page < last ? <Link className="btn" href={href(page + 1)} rel="next">Next</Link> : <span />}
    </nav>
  );
}
