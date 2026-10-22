import Link from "next/link";
import { HowItWorks } from "@/components/HowItWorks";

export const metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/hero-2.jpg" alt="" />
        <p className="eyebrow">How it works</p>
        <h1>Find property, check who you deal with, then close with confidence</h1>
        <p>For people looking for property, and for the companies and agents who list it.</p>
      </section>
      <HowItWorks />
      <section className="two">
        <div className="card stack">
          <h2>Before you pay anything</h2>
          <ul className="check-list">
            <li>Look at the company&apos;s and agent&apos;s trust level, and which checks passed and when.</li>
            <li>Inspect the property in person. Never pay to “reserve” a property you have not seen.</li>
            <li>Ask for the title documents and have them checked by an approved professional (“Verify this property” on each listing).</li>
            <li>Pay only to a company account named in the agreement, never to a personal account given over the phone.</li>
          </ul>
          <Link className="sec-link" href="/safety">Safety and verification</Link>
        </div>
        <div className="card stack">
          <h2>For companies</h2>
          <ul className="check-list">
            <li>Register the company and invite your team with roles.</li>
            <li>Complete verification: CAC registration, a director&apos;s ID, office address, phone and email.</li>
            <li>Add each property as an asset, then create its listing with photos; we review it before it goes live.</li>
            <li>Run offers, post reels, answer enquiries, and manage leases, rent and receipts in the workspace.</li>
          </ul>
          <Link className="btn primary" href="/signup">Register a company</Link>
        </div>
      </section>
    </div>
  );
}
