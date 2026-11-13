import Link from "next/link";
import { getSession } from "@/lib/auth";
import { myApplications, serviceCategories } from "@/lib/services/verification-network";
import { APPLICATION_STATUS_WORDS, ORG_TYPES, type ApplicationStatus } from "@/lib/verification-network-rules";
import { startApplicationAction } from "./actions";

export const metadata = { title: "Become a verification partner", description: "Qualified property verification, surveying, valuation, legal and due diligence firms can apply to deliver verification through Housy." };
export const dynamic = "force-dynamic";

export default async function VerificationPartners() {
  const session = await getSession();
  const [cats, mine] = await Promise.all([serviceCategories(), session ? myApplications(session.user.id) : Promise.resolve([])]);
  const open = mine.find((a) => !["APPROVED", "REJECTED", "WITHDRAWN"].includes(a.status));
  return (
    <div className="wrap stack-lg vp">
      <section className="vp-hero card">
        <p className="eyebrow">Verification network</p>
        <h1>Become a verification partner</h1>
        <p className="lead">Housy connects buyers, owners and investors with independent, qualified firms that investigate property. Approved partners get their own dashboard, cases assigned to them, their own staff and reports, and are paid for their work.</p>
        <div className="row wrap">
          {open
            ? <Link className="btn primary" href={`/verification-partners/applications/${open.ref}`}>Continue application {open.ref}</Link>
            : <form action={startApplicationAction}><button className="btn primary" type="submit">{session ? "Start an application" : "Create an account and apply"}</button></form>}
          {!session ? <Link className="btn" href={`/login?next=${encodeURIComponent("/verification-partners")}`}>I have an account</Link> : null}
        </div>
        <p className="small muted">Housy is the platform and sets the standards. Each partner is an independent professional firm, responsible for its own work and reports.</p>
      </section>

      {mine.length ? (
        <section className="card stack">
          <h2>Your applications</h2>
          <ul className="vp-list">{mine.map((a) => (
            <li key={a.ref}><Link href={`/verification-partners/applications/${a.ref}`}><strong>{a.ref}</strong> · {a.registeredName || "Not named yet"}</Link><span className={`pill ${a.status === "APPROVED" ? "ok" : a.status === "REJECTED" ? "bad" : a.status === "ADDITIONAL_INFORMATION_REQUIRED" ? "warn" : ""}`}>{APPLICATION_STATUS_WORDS[a.status as ApplicationStatus]}</span></li>
          ))}</ul>
        </section>
      ) : null}

      <section className="vp-grid">
        <div className="card stack">
          <h2>Who can apply</h2>
          <p className="muted">Legally registered organisations that can show their qualifications. Your name does not matter; what you are and what you can prove does.</p>
          <ul className="vp-ticks">{ORG_TYPES.map(([k, label]) => <li key={k}>{label}</li>)}</ul>
        </div>
        <div className="card stack">
          <h2>How it works</h2>
          <ol className="vp-steps">
            <li><strong>Apply.</strong> Tell us about the company, its people, qualifications and where it works, and add your documents. Save as you go.</li>
            <li><strong>Review.</strong> Housy checks the company and its credentials. We may ask for more; you answer here.</li>
            <li><strong>Approval.</strong> You are approved for specific services and states, and get a permanent provider ID.</li>
            <li><strong>Activate.</strong> Your authorised representative gets an invitation to activate the organisation's account and set up its dashboard and staff.</li>
          </ol>
        </div>
      </section>

      <details className="card vp-fold">
        <summary><h2 className="inline-h">Services partners can be approved for ({cats.length})</h2></summary>
        <ul className="vp-cats">{cats.map((c) => <li key={c.code}><strong>{c.name}</strong><span className="small muted">{c.summary} Needs: {c.qualifications.toLowerCase()}.</span></li>)}</ul>
      </details>
    </div>
  );
}
