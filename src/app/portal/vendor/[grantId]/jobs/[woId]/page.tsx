import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { vendorJob } from "@/lib/services/portals";
import { SUBMISSION_LABELS, SUBMISSION_STATUS_LABELS, submittableKinds, type SubmissionKind, type SubmissionStatus } from "@/lib/portal-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { vendorSubmitAction } from "../../../../actions";

export const metadata = { title: "Job", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

export default async function VendorJob({ params, searchParams }: { params: Promise<{ grantId: string; woId: string }>; searchParams?: Promise<SP> }) {
  const { grantId, woId } = await params;
  const s = await searchParams;
  const user = await requireUser();
  if (!UUID.test(grantId) || !UUID.test(woId)) notFound();
  const data = await vendorJob(user.id, grantId, woId);
  if (!data) notFound();
  const { grant, job, submissions } = data;
  const kinds = submittableKinds(job.status);
  const where = [job.asset.address, job.asset.city, job.asset.state].filter(Boolean).join(", ");
  return (
    <div className="stack-lg">
      <div className="portal-head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">Vendor portal · {grant.companyName}</p>
          <h1>{job.ref}: {job.title}</h1>
          <div className="row"><Pill status="OPEN" label={humanize(job.status)} /><span className="pill disc">{humanize(job.priority)} priority</span>{job.safetyRisk ? <span className="pill bad">Safety risk</span> : null}</div>
        </div>
        <Link className="btn" href={`/portal/vendor/${grant.id}`}>All jobs</Link>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <section className="card stack"><h2>The job</h2>
        <dl className="kv">
          <div><dt>Property</dt><dd>{job.asset.name}{where ? <div className="small muted">{where}</div> : null}</dd></div>
          <div><dt>Target date</dt><dd>{job.targetDate ? formatDate(job.targetDate) : "Not set"}</dd></div>
          <div><dt>Approved budget</dt><dd>{job.approvedCostKobo !== null ? formatKobo(job.approvedCostKobo) : "Not set"}</dd></div>
          {job.completedOn ? <div><dt>Completed</dt><dd>{formatDate(job.completedOn)}</dd></div> : null}
        </dl>
        {job.description ? <p style={{ whiteSpace: "pre-wrap" }}>{job.description}</p> : null}
        <p className="small muted">Arrange access through {grant.companyName}. Tenant contact details are not shared through the portal.</p>
      </section>
      <section className="card stack"><h2>Send to {grant.companyName}</h2>
        {kinds.length === 0 ? <p className="muted">Nothing can be sent at this stage of the job.</p> : (
          <form action={vendorSubmitAction} className="stack" encType="multipart/form-data">
            <input type="hidden" name="grantId" value={grant.id} /><input type="hidden" name="workOrderId" value={job.id} />
            <Field label="What are you sending?"><select name="kind" defaultValue={kinds[0]}>{kinds.map((k) => <option key={k} value={k}>{SUBMISSION_LABELS[k]}</option>)}</select></Field>
            <Field label="Amount in naira" hint="For a quotation or invoice. Leave blank for a completion report."><input name="amount" inputMode="decimal" placeholder="150000" /></Field>
            <Field label="Note" hint="What is included, or what you did."><textarea name="note" rows={4} maxLength={2000} /></Field>
            <Field label="Document or photo" hint="Quotation, invoice or completion photo. PDF, JPG, PNG or WEBP, up to 4 MB."><input type="file" name="doc" accept="application/pdf,image/png,image/jpeg,image/webp" /></Field>
            <div className="row"><button className="btn primary" type="submit">Send</button></div>
          </form>
        )}
      </section>
      <section className="card stack"><h2>Sent on this job ({submissions.length})</h2>
        {submissions.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ShowMore limit={5} noun="more" items={submissions.map((x) => (
            <li key={x.id}><div className="stack" style={{ gap: 4, width: "100%" }}>
              <div className="row between"><strong>{SUBMISSION_LABELS[x.kind as SubmissionKind]}{x.amountKobo !== null ? ` · ${formatKobo(x.amountKobo)}` : ""}</strong><Pill status={x.status === "ACCEPTED" ? "ACTIVE" : x.status === "REJECTED" ? "SUSPENDED" : "OPEN"} label={SUBMISSION_STATUS_LABELS[x.status as SubmissionStatus]} /></div>
              {x.note ? <p className="small">{x.note}</p> : null}
              <div className="small muted">{formatDateTime(x.createdAt)}{x.docName ? <> · <a className="tap" href={`/portal/doc/${x.id}`}>{x.docName}</a></> : null}</div>
              {x.decisionNote ? <p className="small"><strong>{grant.companyName}:</strong> {x.decisionNote}</p> : null}
            </div></li>
          ))} />
        )}
      </section>
    </div>
  );
}
