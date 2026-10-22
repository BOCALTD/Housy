import { Fragment } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { kycQueue, revealKycSecret } from "@/lib/services/kyc";
import { requirement, STATUS_LABEL, type KycStatus } from "@/lib/kyc-rules";
import { formatDateTime } from "@/lib/dates";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { decideKycAction, revealKycAction } from "./actions";

export const metadata = { title: "Identity and business checks" };
export const dynamic = "force-dynamic";

export default async function KycAdmin({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const q = await kycQueue(admin.id);
  const revealId = sp(searchParams, "reveal");
  const revealed = revealId && q.waiting.some((w) => w.id === revealId) ? await revealKycSecret(admin.id, revealId) : null;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Identity and business checks</h1>
        <p className="muted">Verify a check only after you have confirmed it against an independent source (for example the CAC public search, the original document, or a call to the number). Record what you relied on: it is kept with the check. You cannot review a check you submitted. Viewing a document or a full ID number is recorded.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stack">
        <h2>Waiting ({q.waiting.length})</h2>
        {q.waiting.length === 0 ? <div className="card"><p className="muted">Nothing is waiting.</p></div> : (
          <ShowMore limit={6} noun="more waiting" items={q.waiting.map((w) => {
            const req = requirement(w.code)!;
            const fields = (w.fields ?? {}) as Record<string, string>;
            return (
              <li key={w.id} id={`k-${w.id}`} className="card kyc-review">
                <div className="row between"><strong>{req.title} · {w.who}</strong><Pill status="PENDING" label={STATUS_LABEL[w.status as KycStatus]} /></div>
                <dl>
                  {Object.entries(fields).map(([k, v]) => <Fragment key={k}><dt>{req.fields.find((f) => f.key === k)?.label ?? k}</dt><dd>{v}</dd></Fragment>)}
                  {w.secretMasked ? <><dt>ID number</dt><dd>{revealId === w.id && revealed ? <code>{revealed}</code> : w.secretMasked}</dd></> : null}
                  {w.docName ? <><dt>Document</dt><dd><a href={`/kyc/doc/${w.id}`} target="_blank" rel="noopener">{w.docName}</a></dd></> : null}
                  <dt>Sent</dt><dd>{formatDateTime(w.submittedAt)}</dd>
                </dl>
                {w.secretMasked && revealId !== w.id ? <form action={revealKycAction}><input type="hidden" name="id" value={w.id} /><button className="btn small" type="submit">Show full ID number</button></form> : null}
                <details className="inline"><summary>Decide</summary>
                  <form action={decideKycAction} className="stack">
                    <input type="hidden" name="id" value={w.id} />
                    <label className="field">Decision<select name="decision" defaultValue="verify"><option value="verify">Verified</option><option value="needs_info">Needs more information</option><option value="reject">Rejected</option>{w.status === "SUBMITTED" ? <option value="start">Start review (under review)</option> : null}</select></label>
                    <label className="field">What was checked (shown publicly)<input name="scope" maxLength={300} defaultValue={req.scope} /></label>
                    <label className="field">What you relied on (kept with the check)<input name="evidence" maxLength={1000} placeholder="For example: CAC public search on 22 Oct 2026; certificate matches" /></label>
                    <label className="field">Known limitations (optional)<input name="limitations" maxLength={1000} /></label>
                    <label className="field">Valid for (months)<input name="months" type="number" min={1} max={60} defaultValue={req.months} /></label>
                    <label className="field">Message to the person<textarea name="note" maxLength={1000} rows={3} placeholder="Needed when asking for more information or rejecting" /></label>
                    <button className="btn primary" type="submit">Save decision</button>
                  </form>
                </details>
              </li>
            );
          })} />
        )}
      </section>
      <section className="stack">
        <h2>Recently decided</h2>
        {q.recent.length === 0 ? <div className="card"><p className="muted">No decisions yet.</p></div> : (
          <ShowMore limit={5} noun="more decisions" items={q.recent.map((r) => (
            <li key={r.id} className="card stack">
              <div className="row between"><span><strong>{requirement(r.code)?.title}</strong> · {r.who}</span><Pill status={r.status === "VERIFIED" ? "ACTIVE" : "SUSPENDED"} label={STATUS_LABEL[r.status as KycStatus]} /></div>
              <p className="small muted">{r.reviewedAt ? formatDateTime(r.reviewedAt) : ""}{r.scope ? ` · ${r.scope}` : ""}{r.reviewNote ? ` · ${r.reviewNote}` : ""}</p>
              {r.status === "VERIFIED" ? (
                <details className="inline"><summary>Revoke</summary>
                  <form action={decideKycAction} className="stack"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="revoke" />
                    <label className="field">Why<input name="note" required minLength={5} maxLength={1000} /></label><button className="btn danger" type="submit">Revoke this check</button></form>
                </details>
              ) : null}
            </li>
          ))} />
        )}
      </section>
    </div>
  );
}
