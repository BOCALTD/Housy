import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { deliveryStats, failureList } from "@/lib/services/delivery";
import { readAlertConfig } from "@/lib/services/alerts";
import { formatDate } from "@/lib/dates";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { alertConfigAction, processNowAction, retryAction } from "./actions";

export const metadata = { title: "Notifications and email" };
export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const page = Math.max(0, Number.parseInt(sp(searchParams, "page") ?? "0", 10) || 0);
  const [s, fails, cfg] = await Promise.all([deliveryStats(admin.id, 7), failureList(admin.id, page), readAlertConfig()]);
  const pct = s.successRate == null ? "no sends yet" : `${Math.round(s.successRate * 100)}%`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Notifications and email</h1><p className="muted">The last {s.days} days. <Link href="/admin">Back to admin</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {!s.configured ? <div className="card"><p><strong>No email provider is connected.</strong> Emails are queued and shown here as waiting; none are sent and none are marked as sent. Connect a provider (see the README), then process the queue.</p></div> : null}
      <section className="card stack">
        <h2>Delivery</h2>
        <div className="grid">
          {[["Queued", s.total], ["Sent", s.sent], ["Waiting", s.waiting], ["Will retry", s.retrying], ["Gave up", s.dead], ["Held for digest", s.held], ["In a digest", s.digested], ["Skipped by choice", s.skipped]].map(([k, v]) => <div key={String(k)} className="stack" style={{ gap: 2 }}><span className="small muted">{k}</span><strong>{v}</strong></div>)}
        </div>
        <p className="small">Delivery rate (sent against sent plus gave up): <strong>{pct}</strong></p>
        <form action={processNowAction}><button className="btn" type="submit">Process the queue now</button></form>
        <details className="inline"><summary>What the system decided ({Object.values(s.outcomes).reduce((a, b) => a + b, 0)})</summary>
          <ul>{Object.entries(s.outcomes).map(([k, v]) => <li key={k}>{k.toLowerCase()}: {v}</li>)}{Object.keys(s.outcomes).length === 0 ? <li>Nothing yet.</li> : null}</ul>
          <p className="small muted">Deduped: the same event twice in a day. Held: waiting for a digest. Deferred: waiting for quiet hours to end. Skipped: the person switched it off or never opted in.</p></details>
        <details className="inline"><summary>By kind of email</summary><ul>{s.byTemplate.map((t) => <li key={t.template}>{t.template.replace(/_/g, " ")}: {t.count}</li>)}</ul></details>
        <details className="inline"><summary>Sent each day</summary><ul>{s.perDay.map((d) => <li key={d.day}>{d.day}: {d.count}</li>)}{s.perDay.length === 0 ? <li>None sent.</li> : null}</ul></details>
        <p className="small muted">Failed sends are retried after {s.backoff.map((m) => (m >= 60 ? `${m / 60} h` : `${m} min`)).join(", ")}, then marked as given up.</p>
      </section>
      <section className="card stack">
        <h2>Failed or retrying ({fails.total})</h2>
        {fails.total === 0 ? <p className="muted">No failures.</p> : (
          <>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <form action={retryAction}><input type="hidden" name="id" value="ALL_DEAD" /><button className="btn small" type="submit">Try all given-up emails again</button></form>
              <form action={retryAction}><input type="hidden" name="id" value="ALL_FAILED" /><button className="btn small" type="submit">Try all retrying emails now</button></form>
            </div>
            <ShowMore noun="more" limit={5} items={fails.rows.map((r) => (
              <li key={r.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
                <div><strong>{r.template.replace(/_/g, " ")}</strong> to <span className="mono" style={{ overflowWrap: "anywhere" }}>{r.email}</span> <span className="small muted">· {r.status === "DEAD" ? "gave up" : "will retry"} · {r.attempts} {r.attempts === 1 ? "try" : "tries"} · {formatDate(r.createdAt)}</span></div>
                <p className="small" style={{ overflowWrap: "anywhere" }}>{r.lastError || "No error recorded."}</p>
                <form action={retryAction}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit">Try again</button></form>
              </div></li>))} />
            {fails.pages > 1 ? (
              <div className="row between">
                {fails.page > 0 ? <Link className="btn" href={`/admin/notifications?page=${fails.page - 1}`}>Previous</Link> : <span />}
                {fails.page + 1 < fails.pages ? <Link className="btn" href={`/admin/notifications?page=${fails.page + 1}`}>Next</Link> : <span />}
              </div>
            ) : null}
          </>
        )}
      </section>
      <section className="card stack">
        <h2>Who hears about a new property</h2>
        <p className="muted">A newly approved property tells only people who asked: they saved a matching search, follow the agent or company, or chose the area. Each person is told once, and never the property's own company.</p>
        <form action={alertConfigAction} className="stack">
          <label className="row" style={{ gap: 8 }}><input type="checkbox" name="savedSearches" defaultChecked={cfg.savedSearches} /><span>People with a matching saved search</span></label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" name="followers" defaultChecked={cfg.followers} /><span>Followers of the agent or company</span></label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" name="areas" defaultChecked={cfg.areas} /><span>People who chose the area in their settings</span></label>
          <Field label="Most people one property can reach" hint="1 to 1000. Saved searches and followers come first."><input name="maxRecipients" inputMode="numeric" defaultValue={cfg.maxRecipients} required /></Field>
          <button className="btn primary" type="submit">Save rules</button>
        </form>
      </section>
    </div>
  );
}
