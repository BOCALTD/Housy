import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { applicationForAdmin, serviceCategories, unlinkedProviders } from "@/lib/services/verification-network";
import { STATES } from "@/lib/geo-rules";
import { humanize } from "@/lib/labels";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { APPLICATION_STATUS_WORDS, DOC_KINDS, ORG_TYPES, canMoveApplication, type ApplicationStatus } from "@/lib/verification-network-rules";
import { approveAction, noteAction, rejectAction, requestInfoAction, startReviewAction } from "../../actions";

export const metadata = { title: "Review application" };
export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function ReviewApplication({ params: p, searchParams: s }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await p;
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const app = await applicationForAdmin(admin.id, decodeURIComponent(ref));
  if (!app) notFound();
  const [cats, unlinked] = await Promise.all([serviceCategories(false), unlinkedProviders(admin.id)]);
  const st = app.status as ApplicationStatus;
  const c = app.answers.corporate, o = app.answers.ownership, q = app.answers.qualifications, op = app.answers.operations;
  const invite = sp(searchParams, "invite");
  const soon = (d: string) => d && new Date(d) < new Date(Date.now() + 90 * 864e5);

  return (
    <div className="stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow"><Link href="/admin/verification">Verification network</Link> · {app.ref}</p>
        <h1>{app.registeredName || "Unnamed application"}</h1>
        <p className="row wrap"><span className={`pill ${st === "APPROVED" ? "ok" : st === "REJECTED" ? "bad" : "warn"}`}>{APPLICATION_STATUS_WORDS[st]}</span>
          <span className="small muted">Applicant: {app.applicant?.name} ({app.applicant?.email})</span>
          {app.provider ? <Link className="small" href={`/admin/verification/providers/${app.providerId}`}>Provider {app.provider.providerCode}</Link> : null}</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {invite ? (
        <section className="card stack vp-invite" role="status">
          <h2>Activation link for {o?.repEmail}</h2>
          <p className="small muted">Send it to the authorised representative yourself (it is shown only once). If they already have an account, they were also told in Housy.</p>
          <input readOnly value={invite} aria-label="Activation link" className="vp-link" />
        </section>
      ) : null}

      <div className="two">
        <div className="stack">
          <section className="card stack">
            <h2>Company</h2>
            {c ? (
              <dl className="vp-dl">
                <dt>Registered name</dt><dd>{c.registeredName}{c.tradingName ? ` (trading as ${c.tradingName})` : ""}</dd>
                <dt>Kind</dt><dd>{ORG_TYPES.find((x) => x[0] === c.orgType)?.[1]}</dd>
                <dt>CAC</dt><dd>{c.cacNumber} · {humanize(c.registrationType)} · {c.yearIncorporated} · {c.country}</dd>
                <dt>Registered office</dt><dd className="pre">{c.registeredAddress}</dd>
                {c.operationalAddresses ? <><dt>Other offices</dt><dd className="pre">{c.operationalAddresses}</dd></> : null}
                <dt>Contact</dt><dd>{c.officialEmail} · {c.officialPhone}{c.website ? <> · <a href={c.website} rel="noopener noreferrer nofollow" target="_blank">{c.website}</a></> : null}</dd>
                <dt>Profile</dt><dd className="pre">{c.profile}</dd>
              </dl>
            ) : <p className="muted">Not filled in.</p>}
          </section>
          <section className="card stack">
            <h2>Ownership and contacts</h2>
            {o ? (
              <dl className="vp-dl">
                <dt>Principal contact</dt><dd>{o.contactName}, {o.contactPosition}</dd>
                <dt>Authorised representative</dt><dd>{o.repName}, {o.repPosition} · {o.repEmail} · {o.repPhone}</dd>
                <dt>Directors</dt><dd>{o.directors.length ? o.directors.map((d) => `${d.name}${d.position ? ` (${d.position})` : ""}`).join("; ") : "None given"}</dd>
                {o.ownershipNote ? <><dt>Notes</dt><dd className="pre">{o.ownershipNote}</dd></> : null}
              </dl>
            ) : <p className="muted">Not filled in.</p>}
          </section>
          <section className="card stack">
            <h2>Qualifications</h2>
            {q ? (
              <dl className="vp-dl">
                <dt>Services asked for</dt><dd>{q.services.map((x) => cats.find((k) => k.code === x)?.name ?? x).join("; ")}</dd>
                {q.memberships ? <><dt>Memberships</dt><dd className="pre">{q.memberships}</dd></> : null}
                <dt>Licences</dt><dd>{q.licences.length ? <ul className="plain">{q.licences.map((l, i) => <li key={i}>{l.body} {l.number}{l.expires ? <span className={soon(l.expires) ? "warn-text" : "muted"}> · until {l.expires}</span> : null}</li>)}</ul> : "None given"}</dd>
                <dt>Responsible professionals</dt><dd><ul className="plain">{q.professionals.map((x, i) => <li key={i}><strong>{x.name}</strong> · {x.qualification}{x.licenceNumber ? ` · ${x.licenceNumber}` : ""}{x.expires ? <span className={soon(x.expires) ? "warn-text" : "muted"}> · until {x.expires}</span> : null}</li>)}</ul></dd>
                {q.accreditation ? <><dt>Accreditation</dt><dd className="pre">{q.accreditation}</dd></> : null}
                {q.certifications ? <><dt>Certifications</dt><dd className="pre">{q.certifications}</dd></> : null}
              </dl>
            ) : <p className="muted">Not filled in.</p>}
          </section>
          <section className="card stack">
            <h2>Operations</h2>
            {op ? (
              <dl className="vp-dl">
                <dt>States</dt><dd>{op.states.join(", ")}</dd>
                {op.locationsNote ? <><dt>Locations</dt><dd className="pre">{op.locationsNote}</dd></> : null}
                <dt>Property types</dt><dd>{op.propertyTypes.map(humanize).join(", ")}</dd>
                <dt>People</dt><dd>{op.professionalStaff} professional staff · {op.fieldInvestigators} field investigators · about {op.monthlyCapacity} assignments a month</dd>
                <dt>Previous work</dt><dd className="pre">{op.previousProjects}</dd>
                {op.references ? <><dt>References</dt><dd className="pre">{op.references}</dd></> : null}
                {op.resources ? <><dt>Resources</dt><dd className="pre">{op.resources}</dd></> : null}
              </dl>
            ) : <p className="muted">Not filled in.</p>}
          </section>
          <section className="card stack">
            <h2>Documents ({app.documents.length})</h2>
            {app.documents.length ? <ul className="vp-docs">{app.documents.map((d) => (
              <li key={d.id}><span><strong>{d.title}</strong><span className="small muted">{DOC_KINDS.find((k) => k[0] === d.kind)?.[1]} · {d.fileName} · {kb(d.sizeBytes)}{d.expiresOn ? ` · valid until ${d.expiresOn.toISOString().slice(0, 10)}` : ""} · fingerprint {d.sha256.slice(0, 12)}</span></span>
                <a className="btn small" href={`/verification-partners/doc/${d.id}`} target="_blank" rel="noopener">Open</a></li>
            ))}</ul> : <p className="muted">None.</p>}
            {app.missing.length ? <div className="flash warn"><strong>Missing:</strong> {app.missing.join(". ")}</div> : null}
          </section>
        </div>

        <aside className="stack">
          <section className="card stack">
            <h2>Decision</h2>
            {canMoveApplication(st, "UNDER_REVIEW", "admin") ? (
              <form action={startReviewAction}><input type="hidden" name="ref" value={app.ref} /><button className="btn primary" type="submit">Start the review</button></form>
            ) : null}
            {canMoveApplication(st, "ADDITIONAL_INFORMATION_REQUIRED", "admin") ? (
              <details className="vp-fold"><summary>Ask for more information</summary>
                <form action={requestInfoAction} className="stack"><input type="hidden" name="ref" value={app.ref} />
                  <Field label="What you need" hint="The applicant sees this"><textarea name="message" required minLength={10} maxLength={3000} rows={4} /></Field>
                  <button className="btn" type="submit">Send request</button></form>
              </details>
            ) : null}
            {canMoveApplication(st, "APPROVED", "admin") ? (
              <details className="vp-fold" open><summary>Approve</summary>
                <form action={approveAction} className="stack"><input type="hidden" name="ref" value={app.ref} />
                  <Field label="Short name" hint="Shown on its dashboard and to customers"><input name="shortName" required maxLength={40} defaultValue={(c?.tradingName || c?.registeredName || "").split(" ").slice(0, 3).join(" ")} /></Field>
                  <fieldset className="vp-fs"><legend>Approved services</legend>
                    <div className="vp-checks">{cats.map((k) => <label key={k.code} className="check"><input type="checkbox" name="allowedServices" value={k.code} defaultChecked={q?.services.includes(k.code)} /> {k.name}</label>)}</div></fieldset>
                  <details className="vp-fold"><summary>Approved states ({op?.states.length ?? 0} asked for)</summary>
                    <div className="vp-checks vp-states">{STATES.map((x) => <label key={x.name} className="check"><input type="checkbox" name="allowedStates" value={x.name} defaultChecked={op?.states.includes(x.name)} /> {x.name}</label>)}</div></details>
                  {unlinked.length ? <Field label="Link to a provider already listed" hint="Only if this application is from an organisation already shown on Housy"><select name="linkProviderId" defaultValue=""><option value="">No: create a new provider</option>{unlinked.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.shortName})</option>)}</select></Field> : null}
                  <Field label="Note for the record" hint="Optional; the applicant sees it"><textarea name="note" rows={2} maxLength={3000} /></Field>
                  <label className="check"><input type="checkbox" name="confirm" value="yes" required /> I have checked the company, its documents and its credentials.</label>
                  <button className="btn primary" type="submit" data-confirm="Approve this organisation?" data-confirm-body="It gets a permanent provider ID and an activation invitation goes to its authorised representative." data-confirm-ok="Approve" data-confirm-tone="default">Approve</button>
                </form>
              </details>
            ) : null}
            {canMoveApplication(st, "REJECTED", "admin") ? (
              <details className="vp-fold"><summary>Reject</summary>
                <form action={rejectAction} className="stack"><input type="hidden" name="ref" value={app.ref} />
                  <Field label="Reason" hint="The applicant sees this"><textarea name="reason" required minLength={10} maxLength={3000} rows={3} /></Field>
                  <button className="btn danger" type="submit" data-confirm="Reject this application?" data-confirm-body="The applicant is told, with your reason. This cannot be undone; they can apply again." data-confirm-ok="Reject">Reject</button></form>
              </details>
            ) : null}
            {["APPROVED", "REJECTED", "WITHDRAWN", "DRAFT"].includes(st) ? <p className="small muted">No decision to make at this stage.</p> : null}
          </section>
          <section className="card stack">
            <h2>History and notes</h2>
            <ol className="vp-timeline">{app.events.map((e, i) => (
              <li key={i} className={e.internal ? "internal" : ""}><strong>{humanize(e.action)}</strong> <span className="small muted">by {e.actor}, {when(e.createdAt)}{e.internal ? " · Housy only" : ""}</span>{e.note ? <p className="small pre">{e.note}</p> : null}</li>
            ))}</ol>
            <form action={noteAction} className="stack"><input type="hidden" name="ref" value={app.ref} />
              <Field label="Internal note" hint="Seen by Housy only"><textarea name="note" rows={2} maxLength={3000} required /></Field>
              <button className="btn small" type="submit">Add note</button></form>
          </section>
        </aside>
      </div>
    </div>
  );
}
