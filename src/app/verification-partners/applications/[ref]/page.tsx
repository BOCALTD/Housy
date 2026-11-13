import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { applicationForApplicant, serviceCategories } from "@/lib/services/verification-network";
import { STATES } from "@/lib/geo-rules";
import { humanize } from "@/lib/labels";
import { Field, Flash, sp, type SP } from "@/components/ui";
import {
  APPLICATION_PARTS, APPLICATION_STATUS_WORDS, DOC_KINDS, ORG_TYPES, PROPERTY_TYPES, REGISTRATION_TYPES, REQUIRED_DOCS, applicantMayEdit,
  type ApplicationAnswers, type ApplicationStatus,
} from "@/lib/verification-network-rules";
import { addDocumentAction, removeDocumentAction, savePartAction, submitApplicationAction, withdrawApplicationAction } from "../../actions";

export const metadata = { title: "Verification partner application", robots: { index: false } };
export const dynamic = "force-dynamic";

const STEPS = [...APPLICATION_PARTS.map((p) => ({ key: p.key as string, title: p.title })), { key: "documents", title: "Documents" }, { key: "review", title: "Check and send" }];
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (d: Date) => d.toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const EVENT_WORDS: Record<string, string> = { started: "Started", submitted: "Sent to Housy", resubmitted: "Sent again", review_started: "Housy started the review", information_requested: "Housy asked for more information", approved: "Approved", rejected: "Not approved", withdrawn: "Withdrawn" };

export default async function ApplicationPage({ params: p, searchParams: s }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await p;
  const searchParams = await s;
  const user = await requireUser();
  const app = await applicationForApplicant(user.id, decodeURIComponent(ref));
  if (!app) notFound();
  const status = app.status as ApplicationStatus;
  const editable = applicantMayEdit(status);
  const step = editable ? (STEPS.find((x) => x.key === sp(searchParams, "step"))?.key ?? (status === "DRAFT" ? "corporate" : "review")) : "summary";
  const a = app.answers as ApplicationAnswers;
  const cats = await serviceCategories();
  const done = (k: string) => (k === "documents" ? REQUIRED_DOCS.every((d) => app.documents.some((x) => x.kind === d)) : k === "review" ? false : !!a[k as keyof ApplicationAnswers]);

  return (
    <div className="wrap stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow"><Link href="/verification-partners">Verification partners</Link> · Application {app.ref}</p>
        <h1>{app.registeredName || "Your application"}</h1>
        <p><span className={`pill ${status === "APPROVED" ? "ok" : status === "REJECTED" ? "bad" : status === "ADDITIONAL_INFORMATION_REQUIRED" ? "warn" : ""}`}>{APPLICATION_STATUS_WORDS[status]}</span></p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {status === "ADDITIONAL_INFORMATION_REQUIRED" ? (
        <section className="card vp-ask stack" role="note"><h2>What Housy needs</h2><p className="pre">{app.infoRequest}</p><p className="small muted">Change your answers or add documents below, then send the application again from <Link href="?step=review">Check and send</Link>.</p></section>
      ) : null}
      {status === "REJECTED" && app.decisionReason ? <section className="card stack"><h2>Reason</h2><p className="pre">{app.decisionReason}</p></section> : null}
      {status === "APPROVED" ? <section className="card stack"><h2>Approved</h2><p>Your organisation is approved. The authorised representative has been sent an invitation to activate its account; once it is active, staff can be invited from the organisation&apos;s dashboard.</p><Link className="btn primary" href="/provider">Go to verification work</Link></section> : null}

      {editable ? (
        <nav className="vp-stepper" aria-label="Application steps">
          <ol>{STEPS.map((x, i) => (
            <li key={x.key} className={`${x.key === step ? "on" : ""}${done(x.key) ? " done" : ""}`}>
              <Link href={`?step=${x.key}`} aria-current={x.key === step ? "step" : undefined}><span className="vp-n" aria-hidden="true">{done(x.key) ? "✓" : i + 1}</span><span>{x.title}</span></Link>
            </li>
          ))}</ol>
        </nav>
      ) : null}

      {step === "corporate" ? (
        <form action={savePartAction} className="card stack vp-form">
          <input type="hidden" name="ref" value={app.ref} /><input type="hidden" name="part" value="corporate" />
          <h2>Company</h2>
          <div className="grid-2">
            <Field label="Registered company name"><input name="registeredName" required maxLength={200} defaultValue={a.corporate?.registeredName} autoComplete="organization" /></Field>
            <Field label="Trading or operating name" hint="If different"><input name="tradingName" maxLength={200} defaultValue={a.corporate?.tradingName} /></Field>
            <Field label="What kind of organisation"><select name="orgType" required defaultValue={a.corporate?.orgType ?? ""}><option value="" disabled>Choose…</option>{ORG_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Registration type"><select name="registrationType" required defaultValue={a.corporate?.registrationType ?? ""}><option value="" disabled>Choose…</option>{REGISTRATION_TYPES.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
            <Field label="CAC registration number" hint="As on the certificate, like RC 1234567"><input name="cacNumber" required maxLength={30} defaultValue={a.corporate?.cacNumber} /></Field>
            <Field label="Year of incorporation"><input name="yearIncorporated" type="number" inputMode="numeric" required min={1900} max={new Date().getFullYear()} defaultValue={a.corporate?.yearIncorporated} /></Field>
            <Field label="Country of registration"><input name="country" required maxLength={80} defaultValue={a.corporate?.country ?? "Nigeria"} autoComplete="country-name" /></Field>
            <Field label="Company website" hint="Optional"><input name="website" type="url" maxLength={300} placeholder="https://" defaultValue={a.corporate?.website} /></Field>
            <Field label="Official company email"><input name="officialEmail" type="email" required maxLength={200} defaultValue={a.corporate?.officialEmail} autoComplete="email" /></Field>
            <Field label="Official telephone number"><input name="officialPhone" type="tel" required maxLength={30} defaultValue={a.corporate?.officialPhone} autoComplete="tel" /></Field>
          </div>
          <Field label="Registered office address"><textarea name="registeredAddress" required rows={2} maxLength={400} defaultValue={a.corporate?.registeredAddress} /></Field>
          <Field label="Operational office addresses" hint="Optional. One per line"><textarea name="operationalAddresses" rows={2} maxLength={1200} defaultValue={a.corporate?.operationalAddresses} /></Field>
          <Field label="Company profile" hint="What the company does, its history and its approach, in a few sentences or more"><textarea name="profile" required rows={5} maxLength={3000} minLength={40} defaultValue={a.corporate?.profile} /></Field>
          <div className="row"><button className="btn primary" type="submit">Save and continue</button></div>
        </form>
      ) : null}

      {step === "ownership" ? (
        <form action={savePartAction} className="card stack vp-form">
          <input type="hidden" name="ref" value={app.ref} /><input type="hidden" name="part" value="ownership" />
          <h2>Ownership and contacts</h2>
          <div className="grid-2">
            <Field label="Principal contact person"><input name="contactName" required maxLength={120} defaultValue={a.ownership?.contactName ?? user.name} /></Field>
            <Field label="Their position"><input name="contactPosition" required maxLength={120} defaultValue={a.ownership?.contactPosition} /></Field>
          </div>
          <fieldset className="stack vp-fs"><legend>Authorised representative</legend>
            <p className="small muted">The person authorised to act for the organisation. If it is approved, they get the invitation to activate its account as owner.</p>
            <div className="grid-2">
              <Field label="Name"><input name="repName" required maxLength={120} defaultValue={a.ownership?.repName} /></Field>
              <Field label="Position"><input name="repPosition" required maxLength={120} defaultValue={a.ownership?.repPosition} /></Field>
              <Field label="Email"><input name="repEmail" type="email" required maxLength={200} defaultValue={a.ownership?.repEmail ?? user.email} /></Field>
              <Field label="Telephone"><input name="repPhone" type="tel" required maxLength={30} defaultValue={a.ownership?.repPhone} /></Field>
            </div>
          </fieldset>
          <fieldset className="stack vp-fs"><legend>Directors or controlling officers</legend>
            {[...(a.ownership?.directors ?? []), { name: "", position: "" }, { name: "", position: "" }].slice(0, 20).map((d, i) => (
              <div className="grid-2" key={i}>
                <Field label={`Name ${i + 1}`}><input name={`directors.${i}.name`} maxLength={120} defaultValue={d.name} /></Field>
                <Field label="Position"><input name={`directors.${i}.position`} maxLength={120} defaultValue={d.position} /></Field>
              </div>
            ))}
            <p className="small muted">Two empty rows are added each time you save, if you need more.</p>
          </fieldset>
          <Field label="Ownership and management notes" hint="Optional: anything Housy should know for due diligence"><textarea name="ownershipNote" rows={3} maxLength={1500} defaultValue={a.ownership?.ownershipNote} /></Field>
          <div className="row"><Link className="btn" href="?step=corporate">Back</Link><button className="btn primary" type="submit">Save and continue</button></div>
        </form>
      ) : null}

      {step === "qualifications" ? (
        <form action={savePartAction} className="card stack vp-form">
          <input type="hidden" name="ref" value={app.ref} /><input type="hidden" name="part" value="qualifications" />
          <h2>Professional qualifications</h2>
          <fieldset className="vp-fs"><legend>Services you offer</legend>
            <div className="vp-checks">{cats.map((c) => (
              <label key={c.code} className="check vp-check"><input type="checkbox" name="services" value={c.code} defaultChecked={a.qualifications?.services.includes(c.code)} /><span><strong>{c.name}</strong><small className="muted">Needs: {c.qualifications}</small></span></label>
            ))}</div>
          </fieldset>
          <Field label="Professional memberships" hint="For example NIESV, NIS, NBA"><textarea name="memberships" rows={2} maxLength={1500} defaultValue={a.qualifications?.memberships} /></Field>
          <fieldset className="stack vp-fs"><legend>Licences and registrations</legend>
            {[...(a.qualifications?.licences ?? []), { body: "", number: "", expires: "" }, { body: "", number: "", expires: "" }].slice(0, 20).map((l, i) => (
              <div className="grid-3" key={i}>
                <Field label={`Issuing body ${i + 1}`}><input name={`licences.${i}.body`} maxLength={160} defaultValue={l.body} placeholder="ESVARBON, SURCON…" /></Field>
                <Field label="Number"><input name={`licences.${i}.number`} maxLength={80} defaultValue={l.number} /></Field>
                <Field label="Valid until"><input type="date" name={`licences.${i}.expires`} defaultValue={l.expires} /></Field>
              </div>
            ))}
          </fieldset>
          <div className="grid-2">
            <Field label="Accreditation" hint="Optional"><textarea name="accreditation" rows={2} maxLength={1500} defaultValue={a.qualifications?.accreditation} /></Field>
            <Field label="Certifications" hint="Optional"><textarea name="certifications" rows={2} maxLength={1500} defaultValue={a.qualifications?.certifications} /></Field>
          </div>
          <fieldset className="stack vp-fs"><legend>Responsible professionals</legend>
            <p className="small muted">The qualified people who will sign off the organisation&apos;s work.</p>
            {[...(a.qualifications?.professionals ?? []), { name: "", qualification: "", licenceNumber: "", expires: "" }, { name: "", qualification: "", licenceNumber: "", expires: "" }].slice(0, 30).map((x, i) => (
              <div className="grid-4" key={i}>
                <Field label={`Name ${i + 1}`}><input name={`professionals.${i}.name`} maxLength={120} defaultValue={x.name} /></Field>
                <Field label="Qualification"><input name={`professionals.${i}.qualification`} maxLength={200} defaultValue={x.qualification} /></Field>
                <Field label="Licence number"><input name={`professionals.${i}.licenceNumber`} maxLength={80} defaultValue={x.licenceNumber} /></Field>
                <Field label="Valid until"><input type="date" name={`professionals.${i}.expires`} defaultValue={x.expires} /></Field>
              </div>
            ))}
          </fieldset>
          <div className="row"><Link className="btn" href="?step=ownership">Back</Link><button className="btn primary" type="submit">Save and continue</button></div>
        </form>
      ) : null}

      {step === "operations" ? (
        <form action={savePartAction} className="card stack vp-form">
          <input type="hidden" name="ref" value={app.ref} /><input type="hidden" name="part" value="operations" />
          <h2>Operations and coverage</h2>
          <details className="vp-fold" open={!a.operations}>
            <summary>States you cover{a.operations?.states.length ? ` (${a.operations.states.length} chosen)` : ""}</summary>
            <div className="vp-checks vp-states">{STATES.map((st) => <label key={st.name} className="check"><input type="checkbox" name="states" value={st.name} defaultChecked={a.operations?.states.includes(st.name)} /> {st.name}</label>)}</div>
          </details>
          <Field label="Locations within those states" hint="Optional: cities or areas you know best"><textarea name="locationsNote" rows={2} maxLength={1000} defaultValue={a.operations?.locationsNote} /></Field>
          <fieldset className="vp-fs"><legend>Types of property you investigate</legend>
            <div className="vp-checks">{PROPERTY_TYPES.map((t) => <label key={t} className="check"><input type="checkbox" name="propertyTypes" value={t} defaultChecked={a.operations?.propertyTypes.includes(t)} /> {humanize(t)}</label>)}</div>
          </fieldset>
          <div className="grid-3">
            <Field label="Field investigators"><input name="fieldInvestigators" type="number" inputMode="numeric" min={0} defaultValue={a.operations?.fieldInvestigators ?? 0} /></Field>
            <Field label="Professional staff"><input name="professionalStaff" type="number" inputMode="numeric" min={1} required defaultValue={a.operations?.professionalStaff} /></Field>
            <Field label="Assignments a month" hint="Roughly how many you can take"><input name="monthlyCapacity" type="number" inputMode="numeric" min={1} required defaultValue={a.operations?.monthlyCapacity} /></Field>
          </div>
          <Field label="Previous relevant work"><textarea name="previousProjects" rows={4} required minLength={20} maxLength={3000} defaultValue={a.operations?.previousProjects} /></Field>
          <Field label="References" hint="Optional: clients or organisations who can speak for your work"><textarea name="references" rows={2} maxLength={2000} defaultValue={a.operations?.references} /></Field>
          <Field label="Operational resources" hint="Optional: vehicles, survey equipment, systems"><textarea name="resources" rows={2} maxLength={2000} defaultValue={a.operations?.resources} /></Field>
          <div className="row"><Link className="btn" href="?step=qualifications">Back</Link><button className="btn primary" type="submit">Save and continue</button></div>
        </form>
      ) : null}

      {step === "documents" ? (
        <section className="card stack vp-form">
          <h2>Documents</h2>
          <p className="muted">Required: {REQUIRED_DOCS.map((k) => DOC_KINDS.find((d) => d[0] === k)![1].toLowerCase()).join(", ")}. Add professional licences or certificates for the services you offer. PDF, JPG, PNG, WEBP or Word, up to 4 MB each.</p>
          {app.documents.length ? (
            <ul className="vp-docs">{app.documents.map((d) => (
              <li key={d.id}>
                <span><strong>{d.title}</strong><span className="small muted">{DOC_KINDS.find((k) => k[0] === d.kind)?.[1]} · {d.fileName} · {kb(d.sizeBytes)}{d.expiresOn ? ` · valid until ${d.expiresOn.toISOString().slice(0, 10)}` : ""}</span></span>
                <span className="row">
                  <a className="btn small" href={`/verification-partners/doc/${d.id}`}>Open</a>
                  <form action={removeDocumentAction}><input type="hidden" name="ref" value={app.ref} /><input type="hidden" name="id" value={d.id} />
                    <button className="btn small" type="submit" data-confirm="Remove this document?" data-confirm-body="It comes off your application. You can add it again before sending." data-confirm-ok="Remove">Remove</button></form>
                </span>
              </li>
            ))}</ul>
          ) : <p className="muted">No documents yet.</p>}
          <form action={addDocumentAction} className="stack vp-add">
            <input type="hidden" name="ref" value={app.ref} />
            <div className="grid-3">
              <Field label="Kind of document"><select name="kind" required defaultValue=""><option value="" disabled>Choose…</option>{DOC_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Title" hint="Optional"><input name="title" maxLength={160} placeholder="CAC certificate" /></Field>
              <Field label="Valid until" hint="For licences and certificates"><input type="date" name="expiresOn" /></Field>
            </div>
            <Field label="File"><input type="file" name="file" required accept="application/pdf,image/png,image/jpeg,image/webp,.docx" /></Field>
            <div className="row"><Link className="btn" href="?step=operations">Back</Link><button className="btn" type="submit">Add document</button><Link className="btn primary" href="?step=review">Continue</Link></div>
          </form>
        </section>
      ) : null}

      {step === "review" ? (
        <section className="card stack vp-form">
          <h2>Check and send</h2>
          {app.missing.length ? (
            <div className="flash warn" role="status"><strong>Still needed before you can send:</strong><ul>{app.missing.map((m) => <li key={m}>{m}</li>)}</ul></div>
          ) : <div className="flash notice" role="status">Everything required is here. Read it through, then send.</div>}
          <Summary a={a} documents={app.documents.length} />
          <form action={submitApplicationAction} className="stack">
            <input type="hidden" name="ref" value={app.ref} />
            {status === "ADDITIONAL_INFORMATION_REQUIRED" ? <Field label="Note for Housy" hint="What you changed or added"><textarea name="note" rows={3} maxLength={1500} /></Field> : null}
            <label className="check"><input type="checkbox" name="confirm" value="yes" required /> The information is true and complete, and I am authorised to apply on the organisation&apos;s behalf.</label>
            <div className="row"><Link className="btn" href="?step=documents">Back</Link><button className="btn primary" type="submit" disabled={app.missing.length > 0}>{status === "ADDITIONAL_INFORMATION_REQUIRED" ? "Send again" : "Send application"}</button></div>
          </form>
        </section>
      ) : null}

      {step === "summary" ? <section className="card stack"><h2>What you sent</h2><Summary a={a} documents={app.documents.length} /></section> : null}

      <section className="card stack">
        <h2>History</h2>
        <ol className="vp-timeline">{app.events.map((e, i) => (
          <li key={i}><strong>{EVENT_WORDS[e.action] ?? humanize(e.action)}</strong> <time className="small muted">{when(e.createdAt)}</time>{e.note ? <p className="small pre">{e.note}</p> : null}</li>
        ))}</ol>
        {["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFORMATION_REQUIRED", "RESUBMITTED"].includes(status) ? (
          <details className="inline"><summary>Withdraw this application</summary>
            <form action={withdrawApplicationAction} className="stack">
              <input type="hidden" name="ref" value={app.ref} />
              <Field label="Reason" hint="Optional"><input name="reason" maxLength={1000} /></Field>
              <button className="btn danger" type="submit" data-confirm="Withdraw this application?" data-confirm-body="Housy stops reviewing it. You can start a new application later." data-confirm-ok="Withdraw">Withdraw</button>
            </form>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function Summary({ a, documents }: { a: ApplicationAnswers; documents: number }) {
  const c = a.corporate, o = a.ownership, q = a.qualifications, op = a.operations;
  return (
    <dl className="vp-summary">
      <dt>Company</dt><dd>{c ? `${c.registeredName}${c.tradingName ? ` (trading as ${c.tradingName})` : ""}, ${c.cacNumber}, ${c.country}, since ${c.yearIncorporated}` : "Not filled in"}</dd>
      <dt>Contacts</dt><dd>{o ? `${o.contactName} (${o.contactPosition}); representative ${o.repName}, ${o.repEmail}` : "Not filled in"}</dd>
      <dt>Services</dt><dd>{q ? `${q.services.length} service${q.services.length === 1 ? "" : "s"}; ${q.professionals.length} responsible professional${q.professionals.length === 1 ? "" : "s"}; ${q.licences.length} licence${q.licences.length === 1 ? "" : "s"}` : "Not filled in"}</dd>
      <dt>Coverage</dt><dd>{op ? `${op.states.length} state${op.states.length === 1 ? "" : "s"}; ${op.professionalStaff} professional staff; about ${op.monthlyCapacity} assignments a month` : "Not filled in"}</dd>
      <dt>Documents</dt><dd>{documents}</dd>
    </dl>
  );
}
