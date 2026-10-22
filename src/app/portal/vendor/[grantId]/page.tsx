import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { vendorPortal } from "@/lib/services/portals";
import { SUBMISSION_LABELS, SUBMISSION_STATUS_LABELS, paymentLabel, type SubmissionKind, type SubmissionStatus } from "@/lib/portal-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { vendorProfileAction } from "../../actions";

export const metadata = { title: "Vendor portal", robots: { index: false } };
export const dynamic = "force-dynamic";

const DONE = ["COMPLETED", "CLOSED"];

export default async function VendorPortal({ params, searchParams }: { params: Promise<{ grantId: string }>; searchParams?: Promise<SP> }) {
  const { grantId } = await params;
  const s = await searchParams;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(grantId)) notFound();
  const data = await vendorPortal(user.id, grantId);
  if (!data) notFound();
  const { grant, contractor, jobs, profile, submissions } = data;
  const open = jobs.filter((j) => !DONE.includes(j.status));
  const done = jobs.filter((j) => DONE.includes(j.status));
  const waiting = submissions.filter((x) => x.status === "SUBMITTED").length;
  const accepted = submissions.filter((x) => x.kind === "INVOICE" && x.status === "ACCEPTED");
  const unpaid = accepted.reduce((t, x) => t + (x.amountKobo ?? 0n) - (x.paidAmountKobo ?? 0n), 0n);
  const paid = accepted.reduce((t, x) => t + (x.paidAmountKobo ?? 0n), 0n);
  const row = (j: (typeof jobs)[number]) => (
    <li key={j.id}><Link className="job-row" href={`/portal/vendor/${grant.id}/jobs/${j.id}`}>
      <span><strong>{j.ref}</strong> · {j.title}<span className="small muted"> · {j.asset.name}{j.asset.city ? `, ${j.asset.city}` : ""}{j.targetDate ? ` · due ${formatDate(j.targetDate)}` : ""}</span>{j.safetyRisk ? <span className="pill bad" style={{ marginInlineStart: 6 }}>Safety risk</span> : null}</span>
      <Pill status={DONE.includes(j.status) ? "ACTIVE" : "OPEN"} label={`${humanize(j.priority)} · ${humanize(j.status)}`} />
    </Link></li>
  );
  return (
    <div className="stack-lg">
      <div className="portal-head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">Vendor portal · {grant.companyName}</p>
          <h1>{contractor?.name ?? grant.displayName}</h1>
          <p className="muted small">{contractor?.trade ? `${contractor.trade} · ` : ""}You see the jobs {grant.companyName} assigns to you, and nothing else of theirs.</p>
        </div>
        <Link className="btn" href="/portal">All portals</Link>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      {contractor && !contractor.active ? <p className="flash error" role="alert">{grant.companyName} has paused work with you. You can still see past jobs.</p> : null}
      <div className="portal-kpis" role="list">
        <div className="kpi" role="listitem"><strong>{open.length}</strong><span>Open jobs</span></div>
        <div className="kpi" role="listitem"><strong>{done.length}</strong><span>Completed</span></div>
        <div className="kpi" role="listitem"><strong>{waiting}</strong><span>Waiting for the company</span></div>
        <div className="kpi" role="listitem"><strong>{formatKobo(unpaid)}</strong><span>Accepted, not yet paid</span></div>
        <div className="kpi" role="listitem"><strong>{formatKobo(paid)}</strong><span>Paid to you</span></div>
      </div>
      <section className="card stack"><h2>Open jobs</h2>
        {open.length ? <ShowMore limit={8} noun="more jobs" items={open.map(row)} /> : <p className="muted">No open jobs right now.</p>}
      </section>
      {done.length ? <details className="card inline"><summary>Completed jobs ({done.length})</summary><ShowMore limit={8} noun="more" items={done.map(row)} /></details> : null}
      <section className="card stack"><h2>What you have sent</h2>
        {submissions.length === 0 ? <p className="muted">Nothing yet. Open a job to send a quotation, invoice or completion report.</p> : (
          <ShowMore limit={6} noun="more" items={submissions.map((x) => {
            const j = jobs.find((y) => y.id === x.workOrderId);
            return (
              <li key={x.id}><div className="row between" style={{ width: "100%" }}>
                <span>{SUBMISSION_LABELS[x.kind as SubmissionKind]}{x.amountKobo !== null ? ` · ${formatKobo(x.amountKobo)}` : ""}<span className="small muted"> · {j ? j.ref : "job"} · {formatDate(x.createdAt)}{x.decisionNote ? ` · ${x.decisionNote}` : ""}</span>{paymentLabel(x) ? <span className="small"><br /><strong>{paymentLabel(x)}</strong>{x.paidOn ? ` · ${x.paidAmountKobo !== null ? formatKobo(x.paidAmountKobo) : ""} on ${formatDate(x.paidOn)}${x.paidReference ? ` · ref ${x.paidReference}` : ""}` : ""}</span> : null}</span>
                <Pill status={x.status === "ACCEPTED" ? "ACTIVE" : x.status === "REJECTED" ? "SUSPENDED" : "OPEN"} label={SUBMISSION_STATUS_LABELS[x.status as SubmissionStatus]} />
              </div></li>
            );
          })} />
        )}
      </section>
      <section className="card stack" id="profile"><h2>Your profile</h2>
        <p className="small muted">{grant.companyName} sees this when they decide what work to give you. {profile ? `Last updated ${formatDate(profile.updatedAt)}.` : ""}</p>
        <form action={vendorProfileAction} className="stack" encType="multipart/form-data">
          <input type="hidden" name="grantId" value={grant.id} />
          <Field label="Service areas" hint="Cities or neighbourhoods you cover."><input name="serviceAreas" maxLength={500} defaultValue={profile?.serviceAreas ?? ""} /></Field>
          <Field label="Qualifications and trade memberships"><textarea name="qualifications" rows={4} maxLength={2000} defaultValue={profile?.qualifications ?? ""} /></Field>
          <Field label="Insurance" hint="Insurer, policy type and expiry date."><input name="insuranceNote" maxLength={500} defaultValue={profile?.insuranceNote ?? ""} /></Field>
          <Field label="Compliance document" hint={profile?.docName ? `On file: ${profile.docName}. Choose a new file to replace it. PDF, JPG, PNG or WEBP, up to 4 MB.` : "PDF, JPG, PNG or WEBP, up to 4 MB."}><input type="file" name="doc" accept="application/pdf,image/png,image/jpeg,image/webp" /></Field>
          <div className="row"><button className="btn primary" type="submit">Save profile</button></div>
        </form>
      </section>
    </div>
  );
}
