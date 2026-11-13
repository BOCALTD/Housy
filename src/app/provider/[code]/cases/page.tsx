import Link from "next/link";
import { Flash, sp, type SP } from "@/components/ui";
import { providerCases } from "@/lib/services/verification-cases";
import { CASE_STATUSES, CASE_STATUS_WORDS } from "@/lib/verification-case-rules";
import { CaseStatusPill, day, serviceName, when } from "@/app/verification/case-ui";
import { OrgHeader, orgFor } from "../shared";

export const metadata = { title: "Verification cases", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ProviderCases({ params: p, searchParams: s }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const { code } = await p;
  const searchParams = await s;
  const ctx = await orgFor(code);
  const status = sp(searchParams, "status") || undefined;
  const { rows, counts } = await providerCases(ctx, { status: status && (CASE_STATUSES as readonly string[]).includes(status) ? status : undefined });
  const now = new Date();
  const stat = (n: number, label: string, st?: string) => <Link className="card" href={`/provider/${ctx.code}/cases${st ? `?status=${st}` : ""}`}><span className="vp-stat">{n}</span><span className="small muted">{label}</span></Link>;
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} title="Verification cases" />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="vp-stats" aria-label="Cases at a glance">
        {stat(counts.offered, "Offered: answer within 48 hours", "ASSIGNED")}
        {stat(counts.working, "Under investigation")}
        {stat(counts.inspections, "Site inspections", "FIELD_INSPECTION")}
        {stat(counts.drafting, "Reports being written", "REPORT_DRAFT")}
        {stat(counts.inReview, "Waiting for internal review", "INTERNAL_REVIEW")}
        {stat(counts.withHousy, "With Housy")}
        {stat(counts.done, "Delivered")}
        {stat(counts.overdue, "Overdue")}
      </section>
      <section className="card stack">
        <form className="vp-filters" method="get">
          <label className="field">Status<select name="status" defaultValue={status ?? ""}><option value="">All</option>{CASE_STATUSES.map((x) => <option key={x} value={x}>{CASE_STATUS_WORDS[x]}</option>)}</select></label>
          <button className="btn" type="submit">Show</button>
        </form>
        {rows.length === 0 ? <p className="muted">{status ? "No cases with this status." : ctx.role === "INVESTIGATOR" ? "No cases have been given to you yet." : "No cases yet. Housy offers cases that match the services you offer and the states you cover."}</p> : (
          <ul className="vp-list">{rows.map((r) => (
            <li key={r.ref}>
              <Link href={`/provider/cases/${r.ref}`}><strong>{r.propertyAddress}</strong>
                <span className="small muted">{r.ref} · {r.state} · {r.services.map(serviceName).join(", ")}{r.priority === "URGENT" ? " · urgent" : ""}</span>
                {r.status === "ASSIGNED" && r.acceptBy ? <span className="small warn-text">Answer by {when(r.acceptBy)}</span> : r.requiredBy ? <span className={`small ${r.requiredBy < now && !["DELIVERED", "COMPLETED"].includes(r.status) ? "bad-text" : "muted"}`}>Due {day(r.requiredBy)}</span> : null}
              </Link>
              <CaseStatusPill status={r.status} />
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
