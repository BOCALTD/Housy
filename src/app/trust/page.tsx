import Link from "next/link";
import { getSession } from "@/lib/auth";
import { myCases } from "@/lib/services/trust-cases";
import { CASE_CATEGORIES, CASE_STATUS_LABEL, EMERGENCY_NUMBERS, type CaseStatus } from "@/lib/booking-rules";
import { TARGET_KINDS } from "@/lib/services/trust-cases";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { openCaseAction } from "./actions";

export const metadata = { title: "Trust and Safety Centre" };
export const dynamic = "force-dynamic";

const GUIDES: [string, string, string][] = [
  ["Before an inspection", "Check the company's and agent's trust level. Meet in daylight, tell someone where you are going, and turn on a safety session from your booking.", "/me/inspections"],
  ["Before you pay", "Never pay to reserve a property you have not inspected. Pay only to a company account named in your agreement, and have the documents checked first.", "/safety"],
  ["Someone bothering you", "Block them from the conversation in Messages, then report them here so we can act.", "/messages"],
  ["What badges mean", "Trust levels come from identity and business checks done by people. They say nothing about a property's title.", "/safety"],
];

export default async function TrustCentre({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const session = await getSession();
  const mine = session ? await myCases(session.user.id) : [];
  const category = sp(s, "category") ?? "";
  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/kyc.jpg" alt="" />
        <p className="eyebrow">Trust and Safety Centre</p>
        <h1>Report a problem, and see what we did about it</h1>
        <p>Suspicious listings, fraud, safety at inspections, harassment, disputes and appeals. Every report is read by a person, gets a deadline by how serious it is, and you are told the outcome.</p>
      </section>
      <p className="flash error" role="note"><strong>In danger right now?</strong> Call {EMERGENCY_NUMBERS.map((n) => `${n.number} (${n.label})`).join(" or ")}. Then tell us.</p>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <div className="two">
        <section className="card stack" aria-labelledby="report-h">
          <h2 id="report-h">Make a report</h2>
          {session ? (
            <form action={openCaseAction} className="stack">
              <label className="field">What is it about?<select name="category" required defaultValue={category}><option value="">Choose…</option>{Object.entries(CASE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <div className="fields">
                <label className="field">What does it concern?<select name="targetKind" defaultValue={sp(s, "targetKind") ?? "OTHER"}>{TARGET_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></label>
                <label className="field">Reference or link (optional)<input name="targetRef" maxLength={200} defaultValue={sp(s, "targetRef") ?? ""} placeholder="For example PROP-AB12CD or a profile link" /></label>
              </div>
              <label className="field">What happened?<textarea name="description" required minLength={10} maxLength={5000} rows={5} /><small>Dates, names used, amounts and how you were contacted help us most. Do not include passwords or card numbers.</small></label>
              <label className="field">Evidence (optional)<input name="evidence" type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" /><small>Up to three screenshots or PDFs, 4 MB each. Only our Trust and Safety team can open them.</small></label>
              <button className="btn primary" type="submit">Send report</button>
            </form>
          ) : <p><Link href="/login">Sign in</Link> to make a report, so we can tell you the outcome. In an emergency, call the numbers above.</p>}
        </section>
        <div className="stack-lg">
          {session ? (
            <section className="card stack" aria-labelledby="mine-h">
              <h2 id="mine-h">My reports</h2>
              {mine.length ? <ShowMore limit={5} noun="more reports" items={mine.map((c) => <li key={c.id} className="row between" style={{ width: "100%" }}><span><Link href={`/trust/reports/${c.ref}`}>{c.ref}</Link> <span className="small muted">· {CASE_CATEGORIES[c.category as keyof typeof CASE_CATEGORIES] ?? c.category} · {formatDate(c.createdAt)}</span></span><Pill status={c.status.startsWith("CLOSED") || c.status === "ACTION_TAKEN" ? "ACTIVE" : "PENDING"} label={CASE_STATUS_LABEL[c.status as CaseStatus]} /></li>)} /> : <p className="muted">You have not made any reports.</p>}
            </section>
          ) : null}
          <section className="card stack" aria-labelledby="guide-h">
            <h2 id="guide-h">Stay safe</h2>
            {GUIDES.map(([t, body, href]) => <details key={t} className="inline"><summary>{t}</summary><p className="small">{body} <Link href={href}>More</Link></p></details>)}
            <p className="small">Appealing a moderation decision on a review, reel or listing? Choose “Appeal a moderation decision” and give its reference.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
