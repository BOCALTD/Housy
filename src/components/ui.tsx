import Link from "next/link";
import { humanize, tone } from "@/lib/labels";

export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${tone(status)}`}>{label ?? humanize(status)}</span>;
}

/** Shows ?error= and ?notice= messages set by server actions. */
/**
 * Messages from a form (?error=, ?notice=, ?warning=) appear as toasts, shown by UrlToasts in the root layout on every page.
 * This keeps a plain copy for anyone browsing without JavaScript.
 */
export function Flash({ searchParams }: { searchParams?: { error?: string; notice?: string; warning?: string } }) {
  const m = searchParams?.error ? ["error", searchParams.error] : searchParams?.warning ? ["warning", searchParams.warning] : searchParams?.notice ? ["notice", searchParams.notice] : null;
  return m ? <noscript><div className={`flash ${m[0]}`}>{m[1]}</div></noscript> : null;
}

/** The cover picture of a property, or the house outline when it has none. */
export function PropPhoto({ id }: { id?: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return id ? <img className="prop-photo" src={`/photos/${id}`} alt="" loading="lazy" decoding="async" /> : <HouseIcon />;
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

/** Cards in a column: the first few show, the rest fold behind "Show more". Each item should be an <li> styled as a card. */
export function CardMore({ items, limit = 6, noun = "more" }: { items: React.ReactNode[]; limit?: number; noun?: string }) {
  const head = items.slice(0, limit);
  const rest = items.slice(limit);
  return (
    <>
      <ul className="card-list">{head}</ul>
      {rest.length > 0 ? (
        <details className="inline">
          <summary>Show {rest.length} {noun}</summary>
          <ul className="card-list">{rest}</ul>
        </details>
      ) : null}
    </>
  );
}

/** A table that shows the first rows and folds the rest behind "Show more", with the same column headings. */
export function TableMore({ head, rows, limit = 10, noun = "more rows", stacked = false }: { head: React.ReactNode; rows: React.ReactNode[]; limit?: number; noun?: string; stacked?: boolean }) {
  // stacked: on phones each row becomes a small card, with every cell labelled from its data-label.
  const cls = stacked ? "stack-table" : undefined;
  const first = rows.slice(0, limit);
  const rest = rows.slice(limit);
  return (
    <>
      <div className="table-wrap"><table className={cls}><thead>{head}</thead><tbody>{first}</tbody></table></div>
      {rest.length > 0 ? (
        <details className="inline">
          <summary>Show {rest.length} {noun}</summary>
          <div className="table-wrap"><table className={cls}><thead>{head}</thead><tbody>{rest}</tbody></table></div>
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
