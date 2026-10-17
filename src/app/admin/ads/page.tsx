import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adQueue, readAdConfig } from "@/lib/services/ads";
import { PHASE_TEXT, PLACEMENTS, phaseOf, type Placement } from "@/lib/ad-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { adConfigAction, liftAdAction, reviewAdAction, suspendAdAction } from "./actions";

export const metadata = { title: "Advertising" };
export const dynamic = "force-dynamic";

const STATES = ["PENDING_REVIEW", "APPROVED", "PAUSED", "SUSPENDED", "ENDED", "REJECTED"] as const;

export default async function AdminAdsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [q, cfg] = await Promise.all([adQueue(admin.id, { status: sp(searchParams, "status"), page }), readAdConfig()]);
  const now = new Date();
  const link = (s: string, p = 0) => `/admin/ads?status=${s}&page=${p}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Advertising</h1><p className="muted">Review adverts before they run, suspend any that should not, and set what a click costs. <Link href="/admin/payments">Payments</Link> · <Link href="/admin/finance">Ledgers</Link> · <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <nav className="nav nav-scroll" aria-label="Campaign states">
        {STATES.map((s) => <Link key={s} href={link(s)} aria-current={s === q.status ? "page" : undefined}>{humanize(s)} ({q.counts[s] ?? 0})</Link>)}
      </nav>
      <section className="stack">
        {q.rows.length === 0 ? <p className="muted">Nothing here.</p> : q.rows.map((c) => {
          const ph = phaseOf(c as never, now);
          return (
            <div key={c.id} className="card stack">
              <div className="row between"><div><strong>{c.name}</strong> <span className="small muted">{c.ref} · {c.ownerName}</span></div><Pill status={ph === "LIVE" ? "ACTIVE" : ph === "SUSPENDED" || ph === "REJECTED" ? "SUSPENDED" : "PENDING"} label={PHASE_TEXT[ph]} /></div>
              <p className="small">{c.listing.title} ({c.listing.publicRef}, {c.listing.city}{c.listing.status !== "PUBLISHED" ? `, ${humanize(c.listing.status)}` : ""}) · {PLACEMENTS[c.placement as Placement].label} · {formatDate(c.startsOn)} to {formatDate(c.endsOn)}</p>
              <p className="small muted">Budget {formatKobo(c.budgetKobo)} · paid {formatKobo(c.fundedKobo)} · spent {formatKobo(c.spentKobo)} · {formatKobo(c.cpcKobo)} a click · shown {c.impressions} · clicked {c.clicks}{c.headline ? ` · headline "${c.headline}"` : ""}</p>
              {c.status === "SUSPENDED" ? <p className="small">Suspended by {c.suspendedBy === "ADMIN" ? "an administrator" : "the system"}: {c.suspendReason}</p> : null}
              {c.reviewNote ? <p className="small muted">Review note: {c.reviewNote}</p> : null}
              <div className="row">
                {c.status === "PENDING_REVIEW" ? (
                  <>
                    <details className="inline"><summary>Approve</summary>
                      <form action={reviewAdAction} className="stack"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value={q.status} /><input type="hidden" name="decision" value="approve" />
                        <Field label="Note (optional)"><input name="note" maxLength={300} /></Field><button className="btn primary" type="submit">Approve and raise the invoice</button></form></details>
                    <details className="inline"><summary>Do not approve</summary>
                      <form action={reviewAdAction} className="stack"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value={q.status} /><input type="hidden" name="decision" value="reject" />
                        <Field label="Why"><input name="note" required minLength={5} maxLength={300} /></Field><button className="btn" type="submit">Send back</button></form></details>
                  </>
                ) : null}
                {c.status === "APPROVED" || c.status === "PAUSED" ? (
                  <details className="inline"><summary>Suspend</summary>
                    <form action={suspendAdAction} className="stack"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value={q.status} /><Field label="Reason"><input name="reason" required minLength={5} maxLength={300} /></Field><button className="btn" type="submit">Suspend</button></form></details>
                ) : null}
                {c.status === "SUSPENDED" && c.suspendedBy === "ADMIN" ? <form action={liftAdAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value={q.status} /><button className="btn" type="submit">Lift suspension</button></form> : null}
                <Link className="btn" href={`/admin/ads/${c.ref}`}>Results</Link>
              </div>
            </div>
          );
        })}
        <div className="row between">
          {page > 0 ? <Link className="btn" href={link(q.status, page - 1)}>Previous</Link> : <span />}
          {(page + 1) * 20 < q.total ? <Link className="btn" href={link(q.status, page + 1)}>Next</Link> : <span />}
        </div>
      </section>
      <details className="inline"><summary>Prices and limits</summary>
        <form action={adConfigAction} className="stack">
          <div className="fields">
            <Field label="Click on the home page (₦)"><input name="homeCpc" required inputMode="decimal" defaultValue={String(cfg.cpcKobo.HOME_FEATURED / 100)} /></Field>
            <Field label="Click in search results (₦)"><input name="searchCpc" required inputMode="decimal" defaultValue={String(cfg.cpcKobo.SEARCH_TOP / 100)} /></Field>
            <Field label="Smallest budget (₦)"><input name="minBudget" required inputMode="decimal" defaultValue={String(cfg.minBudgetKobo / 100)} /></Field>
            <Field label="Largest budget (₦)"><input name="maxBudget" required inputMode="decimal" defaultValue={String(cfg.maxBudgetKobo / 100)} /></Field>
            <Field label="Longest campaign (days)"><input name="maxDays" required inputMode="numeric" defaultValue={cfg.maxDays} /></Field>
          </div>
          <p className="small muted">The price of a click is fixed on each campaign when it is made, so a change here never alters a campaign that already exists.</p>
          <button className="btn" type="submit">Save</button>
        </form></details>
    </div>
  );
}
