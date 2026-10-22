import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/labels";
import { siteCounts } from "@/lib/services/home";

export const metadata = { title: "About us" };
export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const c = await siteCounts().catch(() => null);
  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/hero-3.jpg" alt="" />
        <p className="eyebrow">About</p>
        <h1>{PLATFORM_NAME}: a property marketplace you can check</h1>
        <p>We bring together property seekers, registered companies, agents and developers, with identity checks, reviewed listings and the tools companies need to manage property.</p>
      </section>
      <section className="two">
        <div className="card stack prose">
          <h2>What we do</h2>
          <p>People search for homes, land and commercial space from companies whose identity we have checked. Companies list properties, run offers and post reels, and manage their portfolios (leases, rent, maintenance, inspections, documents and deals) in one workspace.</p>
          <p>We record what we have checked and when, and we say plainly what we have not. Paid plans and adverts are always labelled and never change a trust level or a review.</p>
        </div>
        <div className="card stack">
          <h2>Today</h2>
          {c ? (
            <ul className="check-list">
              <li>{c.listings} published {c.listings === 1 ? "property" : "properties"} in {c.cities} {c.cities === 1 ? "city" : "cities"}</li>
              <li>{c.companies} registered {c.companies === 1 ? "company" : "companies"} with a public profile</li>
              <li>{c.agents} listed {c.agents === 1 ? "agent" : "agents"}</li>
              <li>{c.completed} completed {c.completed === 1 ? "deal" : "deals"} shown with the company&apos;s confirmation</li>
            </ul>
          ) : <p className="muted">Figures are not available right now.</p>}
          <div className="row"><Link className="btn primary" href="/signup">Register a company</Link><Link className="btn" href="/support">Contact us</Link></div>
        </div>
      </section>
    </div>
  );
}
