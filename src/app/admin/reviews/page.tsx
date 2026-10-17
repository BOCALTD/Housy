import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { moderationQueue } from "@/lib/services/reviews";
import { SIGNAL_TEXT, BASIS_LABEL } from "@/lib/reputation-rules";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { caseAction, dismissAction, moderateAction, recomputeAction } from "./actions";

export const metadata = { title: "Review moderation" };
export const dynamic = "force-dynamic";

type R = { id: string; ref: string; overall: number; body: string; basis: string; signals: string; reviewerName: string; createdAt: Date; response: string; status: string };
const Summary = ({ r }: { r: R | null }) => !r ? <p className="muted">Review missing</p> : (
  <div className="stack" style={{ gap: 4 }}>
    <div><strong>{r.overall} out of 5</strong> <span className="small muted">{r.reviewerName} · {BASIS_LABEL[r.basis as "ENQUIRY"]} · {formatDate(r.createdAt)} · <span className="mono">{r.ref}</span> · {humanize(r.status)}</span></div>
    {r.body ? <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{r.body}</p> : null}
    {r.signals ? <p className="small">Signals: {r.signals.split(",").map((s) => SIGNAL_TEXT[s] ?? s).join(" ")}</p> : null}
  </div>
);
const Moderate = ({ id, actions }: { id: string; actions: ("release" | "hide" | "remove" | "restore")[] }) => (
  <form action={moderateAction} className="row"><input type="hidden" name="id" value={id} /><Field label="Note"><input name="note" /></Field>
    {actions.map((a) => <button key={a} className="btn" type="submit" name="action" value={a}>{humanize(a)}</button>)}</form>
);

export default async function AdminReviewsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const q = await moderationQueue(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><p className="eyebrow">Platform Super Super Admin</p><h1>Review moderation</h1>
        <p className="muted">Held reviews, reports, disputes and appeals. Hiding or removing needs a reason, and every step is recorded. <Link href="/admin">Back to platform administration</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Held for checking ({q.held.length})</h2>
        {q.held.length === 0 ? <p className="muted">Nothing is held.</p> : <ShowMore noun="more" limit={4} items={q.held.map((r) => <li key={r.id}><div className="stack" style={{ width: "100%" }}><Summary r={r} /><Moderate id={r.id} actions={["release", "hide", "remove"]} /></div></li>)} />}
      </section>
      <section className="card stack">
        <h2>Disputes and appeals ({q.cases.length})</h2>
        {q.cases.length === 0 ? <p className="muted">None open.</p> : <ShowMore noun="more" limit={4} items={q.cases.map((c) => (
          <li key={c.id}><div className="stack" style={{ width: "100%" }}>
            <p><strong>{humanize(c.kind)}</strong>: {c.reason}</p><Summary r={c.review} />
            <form action={caseAction} className="row"><input type="hidden" name="id" value={c.id} /><Field label="Your reason"><input name="note" required minLength={5} /></Field>
              <button className="btn primary" type="submit" name="decision" value="uphold">Uphold</button><button className="btn" type="submit" name="decision" value="reject">Reject</button></form>
          </div></li>))} />}
      </section>
      <section className="card stack">
        <h2>Reported reviews ({q.reports.length})</h2>
        {q.reports.length === 0 ? <p className="muted">None open.</p> : <ShowMore noun="more" limit={4} items={q.reports.map((x) => (
          <li key={x.id}><div className="stack" style={{ width: "100%" }}>
            <p className="small">Reported: {x.reason}</p><Summary r={x.review} />
            {x.review ? <><Moderate id={x.review.id} actions={["hide", "remove"]} />
              <form action={dismissAction} className="row"><input type="hidden" name="id" value={x.review.id} /><Field label="Note"><input name="note" /></Field><button className="btn" type="submit">Dismiss reports</button></form></> : null}
          </div></li>))} />}
      </section>
      <section className="card stack">
        <h2>Reputation figures</h2>
        <p className="small muted">Figures update whenever a review changes. This rechecks everyone with a record.</p>
        <form action={recomputeAction}><button className="btn" type="submit">Recheck all</button></form>
      </section>
    </div>
  );
}
