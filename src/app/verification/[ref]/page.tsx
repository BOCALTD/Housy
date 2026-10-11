import { notFound } from "next/navigation";
import { getLeadForVisitor } from "@/lib/services/verification";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Pill, sp, type SP } from "@/components/ui";
import { withdrawAction } from "./actions";

export const metadata = { title: "Verification request", robots: { index: false } };

export default async function LeadStatusPage({ params, searchParams }: { params: { ref: string }; searchParams?: SP }) {
  const token = sp(searchParams, "t") ?? "";
  const lead = await getLeadForVisitor(params.ref, token);
  if (!lead) notFound();
  const steps = ["SUBMITTED", "CONTACTED", "IN_PROGRESS", "CLOSED"];
  const reached = steps.indexOf(lead.status);

  return (
    <div className="card stack" style={{ maxWidth: 620, marginInline: "auto" }}>
      <p className="eyebrow">Verification request</p>
      <h1 className="mono">{lead.ref}</h1>
      <p className="muted">Sent to {lead.provider.name} on {formatDateTime(lead.createdAt)} for property {lead.listingRef}.</p>
      <div className="row"><span>Status</span><Pill status={lead.status} /></div>
      {lead.status !== "WITHDRAWN" && lead.status !== "DECLINED" ? (
        <ol className="timeline">
          {steps.map((s, i) => (
            <li key={s} style={{ opacity: i <= reached ? 1 : .45 }}><div>{humanize(s)}</div></li>
          ))}
        </ol>
      ) : null}
      {lead.status === "WITHDRAWN" ? (
        <p>You withdrew this request{lead.withdrawnAt ? ` on ${formatDateTime(lead.withdrawnAt)}` : ""}. Your contact details were removed from it.</p>
      ) : lead.status !== "CLOSED" ? (
        <form action={withdrawAction} className="stack">
          <input type="hidden" name="ref" value={lead.ref} />
          <input type="hidden" name="t" value={token} />
          <p className="small muted">Withdrawing stops further contact and removes your contact details from this request.</p>
          <button className="btn danger" type="submit">Withdraw my request</button>
        </form>
      ) : null}
    </div>
  );
}
