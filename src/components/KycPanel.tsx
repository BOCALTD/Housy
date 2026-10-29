import { formatDate } from "@/lib/dates";
import { STATUS_LABEL, type KycKind } from "@/lib/kyc-rules";
import type { agentKyc } from "@/lib/services/kyc";
import { Pill } from "./ui";
import { AUTO_CODES } from "@/lib/kyc-auto-rules";

type View = Awaited<ReturnType<typeof agentKyc>>;
const PILL: Record<string, string> = { VERIFIED: "ACTIVE", SUBMITTED: "PENDING", UNDER_REVIEW: "PENDING", NEEDS_INFO: "OPEN", REJECTED: "SUSPENDED", EXPIRED: "SUSPENDED", REVOKED: "SUSPENDED", NOT_SUBMITTED: "DRAFT" };

/** Each check with its state, what the reviewer said, and a folded form to submit or resubmit it. */
export function KycPanel({ kind, view, action, docBase, extra, autoReady = false }: { kind: KycKind; view: View; action: (f: FormData) => Promise<void>; docBase: string; extra?: React.ReactNode; autoReady?: boolean }) {
  const t = view.trust;
  return (
    <div className="stack-lg">
      <section className="card stack" aria-labelledby="trust-h">
        <div className="row between"><h2 id="trust-h">Your trust level</h2><span className={`trust l${t.level}`}><i aria-hidden="true">{t.level === 3 ? "★" : t.level === 2 ? "✓" : t.level === 1 ? "•" : "–"}</i>{t.levelName}</span></div>
        <div className="meter" role="img" aria-label={`${t.pct}% of checks passed`}><span style={{ width: `${t.pct}%` }} /></div>
        <p className="small muted">{t.passed.length} of {t.total} checks passed ({t.pct}%). {kind === "COMPANY" ? "Registration and a director's ID are needed for Verified; add the office address and reach 80% for Highly trusted." : "Your ID plus at least half the points are needed for Verified; add your address and reach 80% for Highly trusted."} Checks expire and need renewing.</p>
      </section>
      <ul className="kyc-list">
        {view.items.map(({ req, row, status, fields }) => {
          const open = status === "NOT_SUBMITTED" || status === "NEEDS_INFO" || status === "REJECTED" || status === "EXPIRED" || status === "REVOKED";
          return (
            <li key={req.code} className="card stack kyc-item">
              <div className="row between">
                <div><strong>{req.title}</strong><div className="small muted">{req.why} Counts for {req.weight} points{req.core ? " · required for Verified" : ""}.</div></div>
                <Pill status={PILL[status]} label={STATUS_LABEL[status]} />
              </div>
              {row && status === "VERIFIED" ? <p className="small">{row.scope} on {formatDate(row.verifiedAt!)}{row.expiresAt ? `, valid until ${formatDate(row.expiresAt)}` : ""}.{row.autoOutcome === "MATCH" ? <span className="pill auto-pill">Confirmed automatically</span> : null}</p> : null}
              {row && (status === "SUBMITTED" || status === "UNDER_REVIEW") && ["NO_MATCH", "NOT_FOUND", "UNAVAILABLE"].includes(row.autoOutcome) ? (
                <p className="small flash" role="note">{row.autoOutcome === "UNAVAILABLE" ? "The automatic check could not be completed just now," : "These details could not be confirmed automatically against the official record,"} so a person on our team will check them by hand.{row.autoOutcome !== "UNAVAILABLE" ? " If something was mistyped, send it again." : ""}</p>
              ) : null}
              {row && (status === "NEEDS_INFO" || status === "REJECTED" || status === "REVOKED") && row.reviewNote ? <p className="flash error" role="note">Reviewer: {row.reviewNote}</p> : null}
              {row && (status === "SUBMITTED" || status === "UNDER_REVIEW") ? <p className="small muted">Sent on {formatDate(row.submittedAt)}. Our team usually reviews within two working days.</p> : null}
              {row ? (
                <p className="small muted">
                  {Object.entries(fields).map(([k, v]) => `${req.fields.find((f) => f.key === k)?.label ?? k}: ${v}`).join(" · ")}
                  {row.secretMasked ? ` · ID number: ${row.secretMasked}` : ""}
                  {row.docName ? <> · <a href={`${docBase}/${row.id}`}>{row.docName}</a></> : null}
                </p>
              ) : null}
              <details className="inline" open={false}>
                <summary>{row ? (open ? "Send it again" : "Renew or correct") : "Submit"}</summary>
                <form action={action} className="stack">
                  <input type="hidden" name="code" value={req.code} />
                  {extra}
                  {req.fields.map((f) => (
                    <label key={f.key} className="field">{f.label}{f.required && !(f.kind === "secret" && row?.secretMasked) ? "" : " (optional)"}
                      {f.kind === "select" ? (
                        <select name={f.key} defaultValue={fields[f.key] ?? ""} required={f.required}><option value="">Choose…</option>{f.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      ) : (
                        <input name={f.key} type={f.kind === "date" ? "date" : "text"} autoComplete="off" maxLength={f.max} required={f.required && !(f.kind === "secret" && row?.secretMasked)} defaultValue={f.kind === "secret" ? "" : fields[f.key] ?? ""} placeholder={f.kind === "secret" && row?.secretMasked ? `Leave blank to keep ${row.secretMasked}` : undefined} />
                      )}
                      {f.hint ? <small>{f.hint}</small> : null}
                    </label>
                  ))}
                  {req.document ? (
                    <label className="field">{req.document.label}{row?.docName ? " (leave empty to keep the one on file)" : ""}
                      <input name="doc" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={req.document.required && !row?.docName} />
                      <small>PDF, JPG, PNG or WEBP, up to 4 MB. Only you and our verification team can open it.</small>
                    </label>
                  ) : null}
                  <label className="check"><input type="checkbox" name="confirm" value="yes" required /> The information and document are genuine and I am allowed to share them for verification.</label>
                  {autoReady && AUTO_CODES.includes(req.code) ? (
                    <label className="check"><input type="checkbox" name="auto" value="yes" /> Check these details automatically against the official record ({req.code === "CAC_REGISTRATION" ? "CAC" : req.code === "TAX_ID" ? "FIRS" : "NIMC, INEC or FRSC"}) through our licensed verification partner, so it can be verified in seconds. If it cannot be confirmed that way, our team checks it by hand.{req.code.endsWith("_ID") ? " Works for NIN, voter's cards and driver's licences; passports are always checked by hand." : ""}</label>
                  ) : null}
                  <button className="btn primary" type="submit">Send for review</button>
                </form>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
