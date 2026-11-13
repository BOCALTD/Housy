import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { providerComplaints, providerPerformance } from "@/lib/services/verification-quality";
import { COMPLAINT_CATEGORIES, COMPLAINT_WORDS, EXPIRY_WARNING_DAYS, type ComplaintStatus } from "@/lib/verification-quality-rules";
import { vpCan } from "@/lib/verification-network-rules";
import { day } from "@/app/verification/case-ui";
import { KpiGrid } from "@/app/verification/kpi-ui";
import { OrgHeader, orgFor } from "../shared";
import { respondAction } from "./actions";

export const metadata = { title: "Performance and complaints", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ProviderPerformance({ params: p, searchParams: s }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const { code } = await p;
  const searchParams = await s;
  const ctx = await orgFor(code);
  if (!vpCan(ctx.role, "performance.view")) {
    return <div className="wrap stack-lg vp"><OrgHeader ctx={ctx} title="Performance and complaints" /><div className="card"><p>Your role in this organisation does not include its performance figures.</p></div></div>;
  }
  const [perf, complaints] = await Promise.all([providerPerformance(ctx), providerComplaints(ctx)]);
  const canAnswer = ["OWNER", "ADMIN"].includes(ctx.role);
  const open = complaints.filter((c) => ["OPEN", "INVESTIGATING"].includes(c.status));
  const closed = complaints.filter((c) => !["OPEN", "INVESTIGATING"].includes(c.status));
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} title="Performance and complaints" />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {perf.credentials.expired.length ? (
        <div className="flash error" role="status"><strong>Housy cannot assign you cases.</strong> You have no current {perf.credentials.expired.map((k) => (k === "LICENCE" ? "licence" : "professional certificate")).join(" or ")} on file. <Link href={`/provider/${ctx.code}/documents`}>Upload the renewed document</Link> with its expiry date.</div>
      ) : null}
      {perf.credentials.expiring.length ? (
        <div className="flash warn" role="status"><strong>Expiring within {EXPIRY_WARNING_DAYS} days:</strong> {perf.credentials.expiring.map((d) => `${d.title} (${day(d.expiresOn)})`).join(", ")}. <Link href={`/provider/${ctx.code}/documents`}>Upload the renewals</Link>.</div>
      ) : null}

      <section className="stack">
        <h2>How you are doing</h2>
        <p className="small muted">Counted from your cases on Housy. Housy uses on-time delivery, declines and spare capacity when choosing who to offer a case to.</p>
        <KpiGrid k={perf.kpis} />
        {perf.kpis.flags.length ? <div className="flash warn"><strong>Housy is watching:</strong> {perf.kpis.flags.join("; ")}.</div> : null}
      </section>

      <section className="card stack">
        <h2>Open complaints ({open.length})</h2>
        {open.length === 0 ? <p className="muted small">None.</p> : (
          <ul className="vp-list">{open.map((c) => (
            <li key={c.id} className="stack" style={{ alignItems: "stretch" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <strong>{c.ref} · {COMPLAINT_CATEGORIES.find((x) => x[0] === c.category)?.[1]}{c.caseRef ? <> · <Link href={`/provider/cases/${c.caseRef}`}>{c.caseRef}</Link></> : null}</strong>
                <span className="pill warn">{COMPLAINT_WORDS[c.status as ComplaintStatus]}</span>
              </div>
              <p className="small">{c.byHousy ? <strong>Raised by Housy: </strong> : null}{c.description}</p>
              <span className="small muted">Received {day(c.createdAt)}</span>
              {canAnswer ? (
                <form action={respondAction} className="stack">
                  <input type="hidden" name="code" value={ctx.code} /><input type="hidden" name="complaint" value={c.ref} />
                  <Field label={c.providerResponse ? "Your account (you can update it until Housy decides)" : "Your account"}><textarea name="response" required minLength={20} maxLength={4000} rows={3} defaultValue={c.providerResponse} /></Field>
                  <div className="row"><button className="btn" type="submit">Send to Housy</button></div>
                </form>
              ) : c.providerResponse ? <p className="small"><strong>Your organisation&apos;s account:</strong> {c.providerResponse}</p> : <p className="small muted">The owner or an administrator answers complaints.</p>}
            </li>
          ))}</ul>
        )}
      </section>

      <details className="card vp-fold">
        <summary>Decided complaints ({closed.length})</summary>
        {closed.length ? <ul className="vp-list">{closed.map((c) => (
          <li key={c.id} className="stack" style={{ alignItems: "stretch" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}><strong>{c.ref} · {COMPLAINT_CATEGORIES.find((x) => x[0] === c.category)?.[1]}</strong><span className={`pill ${c.status === "UPHELD" ? "bad" : ""}`}>{COMPLAINT_WORDS[c.status as ComplaintStatus]}</span></div>
            <p className="small">{c.description}</p>
            {c.resolution ? <p className="small"><strong>Housy&apos;s decision:</strong> {c.resolution}</p> : null}
          </li>
        ))}</ul> : <p className="muted small">None.</p>}
      </details>
    </div>
  );
}
