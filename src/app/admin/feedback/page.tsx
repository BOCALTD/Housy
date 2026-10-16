import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { feedbackSummary, listRatings, readFeedbackSettings } from "@/lib/services/feedback";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import SaveDocument from "@/components/SaveDocument";
import { intervalAction, reviewRatingAction } from "./actions";

export const metadata = { title: "Ratings and feedback" };
export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const status = sp(searchParams, "status") ?? "";
  const [sum, list, settings] = await Promise.all([feedbackSummary(admin.id), listRatings(admin.id, { page, status, onlyComments: sp(searchParams, "comments") === "1" }), readFeedbackSettings()]);
  const link = (p: number) => `/admin/feedback?page=${p}${status ? `&status=${status}` : ""}${sp(searchParams, "comments") === "1" ? "&comments=1" : ""}`;
  const show = (n: number | null) => (n == null ? "–" : n.toFixed(1));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><p className="eyebrow">Platform Super Super Admin</p><h1>Ratings and feedback</h1>
        <p className="muted">What people say about the platform. Answers marked anonymous never show a name here. <Link href="/admin">Back to platform administration</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Summary ({sum.total} {sum.total === 1 ? "rating" : "ratings"})</h2>
        <div className="stats">
          <div className="stat"><span className="small muted">Overall</span><strong>{show(sum.overall)}</strong></div>
          <div className="stat"><span className="small muted">Ease of use</span><strong>{show(sum.ease)}</strong></div>
          <div className="stat"><span className="small muted">Trust</span><strong>{show(sum.trust)}</strong></div>
          <div className="stat"><span className="small muted">Help</span><strong>{show(sum.support)}</strong></div>
        </div>
        <details className="inline"><summary>Spread and monthly trend</summary>
          <ul className="timeline">{sum.distribution.map((d) => <li key={d.stars}>{d.stars} out of 5: <strong>{d.count}</strong></li>)}</ul>
          <ul className="timeline">{sum.trend.map((t) => <li key={t.month}>{t.month}: average {show(t.average)} from {t.count}</li>)}</ul>
        </details>
      </section>

      <section className="card stack">
        <h2>How often people are asked</h2>
        <form action={intervalAction} className="row">
          <Field label="Every how many days" hint="“Remind me later” waits 7 days."><input name="intervalDays" inputMode="numeric" defaultValue={settings.intervalDays} /></Field>
          <button className="btn primary" type="submit">Save</button>
        </form>
      </section>

      <section className="card stack">
        <div className="row between"><h2>Answers ({list.total})</h2><SaveDocument url="/admin/feedback/export" fallbackName="platform-ratings.csv" /></div>
        <nav className="row" aria-label="Filter">
          <Link className="btn small" href="/admin/feedback">All</Link>
          <Link className="btn small" href="/admin/feedback?status=NEW">New</Link>
          <Link className="btn small" href="/admin/feedback?comments=1">With suggestions</Link>
        </nav>
        {list.rows.length === 0 ? <p className="muted">Nothing here yet.</p> : (
          <ul className="timeline">{list.rows.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%" }}>
              <div className="row between"><div><strong>{r.overall} out of 5</strong> <span className="small muted">{r.who} · {formatDate(r.createdAt)}</span></div><Pill status={r.status === "NEW" ? "PENDING" : "ACTIVE"} label={humanize(r.status)} /></div>
              {r.suggestion ? <p style={{ whiteSpace: "pre-line" }}>{r.suggestion}</p> : null}
              <details className="inline"><summary>Mark and note</summary>
                <form action={reviewRatingAction} className="row"><input type="hidden" name="id" value={r.id} />
                  <Field label="Status"><select name="status" defaultValue={r.status}>{["NEW", "REVIEWED", "ACTIONED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
                  <Field label="Note"><input name="note" defaultValue={r.adminNote} /></Field>
                  <button className="btn" type="submit">Save</button></form></details>
            </div></li>))}</ul>
        )}
        <div className="row between">
          {list.page > 0 ? <Link className="btn" href={link(list.page - 1)}>Previous</Link> : <span />}
          {list.page + 1 < list.pages ? <Link className="btn" href={link(list.page + 1)}>Next</Link> : <span />}
        </div>
      </section>
    </div>
  );
}
