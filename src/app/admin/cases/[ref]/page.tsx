import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminCase } from "@/lib/services/trust-cases";
import { CASE_CATEGORIES, CASE_STATUSES, CASE_STATUS_LABEL, SEVERITIES, overdue, type CaseStatus } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";
import { Flash, Pill, sp, type SP } from "@/components/ui";
import { caseActionAction, updateCaseAction } from "../actions";

export const metadata = { title: "Case" };
export const dynamic = "force-dynamic";

export default async function CasePage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await params;
  const s = await searchParams;
  const admin = await requirePlatformAdmin();
  const c = await adminCase(admin.id, ref);
  if (!c) notFound();
  const isListing = /^PROP-[A-Z0-9]+$/i.test(c.targetRef.trim());
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow"><Link href="/admin/cases">Cases</Link> · {c.ref}</p>
        <h1>{CASE_CATEGORIES[c.category as keyof typeof CASE_CATEGORIES] ?? c.category}</h1>
        <p><Pill status={c.severity === "CRITICAL" || c.severity === "HIGH" ? "SUSPENDED" : "PENDING"} label={c.severity.toLowerCase()} /> <span className="small muted">{CASE_STATUS_LABEL[c.status as CaseStatus]} · due {formatDateTime(c.dueAt)}{overdue({ status: c.status as CaseStatus, dueAt: c.dueAt }) ? " (overdue)" : ""} · reported {formatDateTime(c.createdAt)} by {c.reporter?.name ?? "a user"}</span></p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <div className="two">
        <section className="card stack">
          <h2>Report</h2>
          <p className="small muted">Concerns: {c.targetKind.toLowerCase()}{c.targetRef ? ` · ${c.targetRef}` : ""}{isListing ? <> · <Link href={`/properties/${c.targetRef.trim().toUpperCase()}`}>open listing</Link></> : null}</p>
          <p style={{ whiteSpace: "pre-line" }}>{c.description}</p>
          {c.evidence.length ? <p className="small">Evidence: {c.evidence.map((e, i) => <span key={e.id}>{i ? ", " : ""}<a href={`/trust/evidence/${e.id}`} target="_blank" rel="noopener">{e.name}</a></span>)}</p> : <p className="small muted">No evidence attached.</p>}
          <h3>History</h3>
          <ul className="timeline">{c.events.map((e) => <li key={e.id}><span><strong>{e.kind.toLowerCase()}</strong>{e.toReporter ? " · seen by reporter" : ""} <span className="small muted">{formatDateTime(e.createdAt)}</span><div className="small" style={{ whiteSpace: "pre-line" }}>{e.body}</div></span></li>)}</ul>
        </section>
        <div className="stack-lg">
          <section className="card stack">
            <h2>Handle</h2>
            <form action={updateCaseAction} className="stack">
              <input type="hidden" name="ref" value={c.ref} />
              <div className="fields">
                <label className="field">Status<select name="status" defaultValue={c.status}>{CASE_STATUSES.map((v) => <option key={v} value={v}>{CASE_STATUS_LABEL[v]}</option>)}</select></label>
                <label className="field">Severity<select name="severity" defaultValue={c.severity}>{SEVERITIES.map((v) => <option key={v} value={v}>{v.toLowerCase()}</option>)}</select></label>
                <label className="field">Investigator<select name="assignToId" defaultValue={c.assignedToId ?? ""}><option value="">Nobody</option>{c.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              </div>
              <label className="field">Private note<textarea name="note" rows={2} maxLength={5000} /></label>
              <label className="field">Message to the reporter<textarea name="messageToReporter" rows={2} maxLength={2000} /><small>Needed when closing: it becomes the outcome they see.</small></label>
              <button className="btn primary" type="submit">Save</button>
            </form>
          </section>
          <section className="card stack">
            <h2>Record an action</h2>
            <form action={caseActionAction} className="stack">
              <input type="hidden" name="ref" value={c.ref} />
              <label className="field">Action<select name="action" defaultValue="RECORD"><option value="RECORD">Record an action taken (warning, suspension, refund…)</option>{isListing ? <option value="TAKE_LISTING_OFFLINE">Take the listing offline now</option> : null}</select></label>
              <label className="field">What was done and why<input name="detail" required minLength={5} maxLength={1000} /></label>
              <button className="btn" type="submit">Record</button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
