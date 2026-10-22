import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { myCase } from "@/lib/services/trust-cases";
import { CASE_CATEGORIES, CASE_STATUS_LABEL, type CaseStatus } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";
import { Flash, Pill, sp, type SP } from "@/components/ui";
import { replyCaseAction } from "../../actions";

export const metadata = { title: "My report" };
export const dynamic = "force-dynamic";

export default async function MyReport({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await params;
  const s = await searchParams;
  const user = await requireUser();
  const c = await myCase(user.id, ref);
  if (!c) notFound();
  const closed = c.status === "ACTION_TAKEN" || c.status === "CLOSED_NO_ACTION";
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Report {c.ref}</p>
        <h1>{CASE_CATEGORIES[c.category as keyof typeof CASE_CATEGORIES] ?? c.category}</h1>
        <p><Pill status={closed ? "ACTIVE" : "PENDING"} label={CASE_STATUS_LABEL[c.status as CaseStatus]} /> <span className="small muted">Sent {formatDateTime(c.createdAt)}{c.targetRef ? ` · about ${c.targetRef}` : ""}</span></p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      {closed && c.outcomeForReporter ? <section className="card stack"><h2>Outcome</h2><p>{c.outcomeForReporter}</p></section> : null}
      <section className="card stack">
        <h2>What you told us</h2>
        <p style={{ whiteSpace: "pre-line" }}>{c.description}</p>
        {c.evidence.length ? <p className="small">Evidence: {c.evidence.map((e, i) => <span key={e.id}>{i ? ", " : ""}<a href={`/trust/evidence/${e.id}`}>{e.name}</a></span>)}</p> : null}
      </section>
      <section className="card stack">
        <h2>Messages</h2>
        <ul className="timeline">{c.events.map((e) => <li key={e.id}><span><strong>{e.kind === "REPLY" ? "You" : "Trust and Safety"}</strong> <span className="small muted">{formatDateTime(e.createdAt)}</span><div style={{ whiteSpace: "pre-line" }}>{e.body}</div></span></li>)}</ul>
        {!closed ? (
          <form action={replyCaseAction} className="stack"><input type="hidden" name="ref" value={c.ref} /><label className="field">Add information<textarea name="body" required minLength={3} maxLength={5000} rows={3} /></label><button className="btn" type="submit">Send</button></form>
        ) : <p className="small muted">This report is closed. If something new happens, <Link href="/trust">make a new report</Link>.</p>}
      </section>
    </div>
  );
}
