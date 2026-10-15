import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { moderationQueue } from "@/lib/services/messaging";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { liftAction, pauseAction, resolveReportAction } from "./actions";

export const metadata = { title: "Message reports" };
export const dynamic = "force-dynamic";

export default async function ModerationPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const q = await moderationQueue(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Message reports</h1><p className="muted">You read a message only because someone reported it. A person reported by {q.threshold} or more different people is flagged. <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{q.reports.length}</b><span>Open reports</span></div>
        <div className="stat"><b>{q.flagged.length}</b><span>Flagged people</span></div>
        <div className="stat"><b>{q.paused}</b><span>Paused</span></div>
      </section>
      <section className="card"><h2>Flagged</h2>
        {q.flagged.length === 0 ? <p className="muted">Nobody is flagged.</p> : (
          <ShowMore noun="more" limit={5} items={q.flagged.map((f) => (
            <li key={f.id}><div className="row between" style={{ width: "100%" }}>
              <div><strong>{f.name}</strong> <span className="small muted">{f.email} · reported by {f.reporters} people{f.paused ? " · paused" : ""}</span></div>
              {f.paused ? <form action={liftAction}><input type="hidden" name="userId" value={f.id} /><button className="btn" type="submit">Restore messaging</button></form> : (
                <details className="inline"><summary>Pause messaging</summary><form action={pauseAction} className="row"><input type="hidden" name="userId" value={f.id} /><input name="reason" required minLength={3} placeholder="Reason, shown to them" aria-label="Reason" /><button className="btn" type="submit">Pause</button></form></details>
              )}
            </div></li>))} />
        )}
      </section>
      <section className="card"><h2>Open reports</h2>
        {q.reports.length === 0 ? <p className="muted">No open reports.</p> : (
          <ShowMore noun="more reports" limit={5} items={q.reports.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="small muted">{formatDate(r.createdAt)} · {r.reporterName} reported {r.senderName}{r.senderPaused ? " (paused)" : ""}</div>
              <div><strong>{humanize(r.kind)}:</strong> {r.body || "(no text)"}{r.masked ? " (contact details were hidden)" : ""}</div>
              <div className="small">Reason: {r.reason}</div>
              <details className="inline"><summary>Decide</summary>
                <form action={resolveReportAction} className="stack"><input type="hidden" name="reportId" value={r.id} />
                  <Field label="What you decided and why"><input name="note" required minLength={3} maxLength={500} /></Field>
                  <label><input type="checkbox" name="pause" /> Also pause {r.senderName}&apos;s messaging</label>
                  <div className="row"><button className="btn primary" type="submit" name="action" value="action">Uphold the report</button><button className="btn" type="submit" name="action" value="dismiss">Dismiss</button></div></form></details>
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
