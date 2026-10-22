import Link from "next/link";
import { LEVELS, requirementsFor } from "@/lib/kyc-rules";

export const metadata = { title: "Safety and verification" };

export default function SafetyPage() {
  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/kyc.jpg" alt="" />
        <p className="eyebrow">Safety and verification</p>
        <h1>What our checks mean, and what they do not</h1>
        <p>Every check is done by a person on our team against an independent source, carries the date it was done, and expires. A badge says exactly what was checked.</p>
      </section>
      <section className="stack">
        <h2>Trust levels</h2>
        <div className="level-grid">
          {LEVELS.map((l) => <div key={l.level}><span className={`trust l${l.level}`}><i aria-hidden="true">{l.level === 3 ? "★" : l.level === 2 ? "✓" : l.level === 1 ? "•" : "–"}</i>{l.name}</span><p className="small">{l.text}</p></div>)}
        </div>
        <p className="small muted">Each check adds points. A company needs its registration and a director&apos;s ID checked (and at least 50 points) to be Verified, and its office address plus at least 80 points to be Highly trusted. An agent needs a government ID checked and at least 50 points to be Verified, and an address plus 80 points to be Highly trusted. Plans and adverts cannot buy a trust level.</p>
      </section>
      <section className="two">
        <div className="card stack">
          <h2>Company checks</h2>
          <ul className="check-list">{requirementsFor("COMPANY").map((r) => <li key={r.code}><span><strong>{r.title}</strong> ({r.weight} points){r.core ? ", needed for Verified" : ""}. {r.why}</span></li>)}</ul>
        </div>
        <div className="card stack">
          <h2>Agent checks</h2>
          <ul className="check-list">{requirementsFor("AGENT").map((r) => <li key={r.code}><span><strong>{r.title}</strong> ({r.weight} points){r.core ? ", needed for Verified" : ""}. {r.why}</span></li>)}</ul>
        </div>
      </section>
      <section className="card stack prose">
        <h2>What a badge does not mean</h2>
        <p>A verified company or agent identity does <strong>not</strong> mean a property&apos;s title is verified, that the property is still available, or that a price is fair. Property documents (C of O, Governor&apos;s Consent, survey plan, deed) are a separate check: use “Verify this property” on a listing to ask an approved professional before you pay.</p>
        <h2>Your documents</h2>
        <p>ID numbers are stored encrypted. Documents are visible only to the person or company that sent them and to our verification team, and every time a reviewer opens one it is recorded. The public sees only the trust level and which checks passed, with their dates.</p>
        <h2>Report a problem</h2>
        <p>If something looks wrong, use the report link on the listing or profile, or <Link href="/support">contact support</Link>. A check can be revoked at any time if new information comes to light.</p>
      </section>
    </div>
  );
}
