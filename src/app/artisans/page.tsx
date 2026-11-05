import Link from "next/link";
import { getSession } from "@/lib/auth";
import { artisanCompanies, myArtisanApplications } from "@/lib/services/artisans";
import { TRADES, tradeLabel } from "@/lib/artisan-rules";
import { TradePicker } from "@/components/TradePicker";
import { applyArtisanAction } from "./actions";

export const metadata = { title: "Artisans", description: "Electricians, plumbers, painters, carpenters and more, registered with property companies on Housy and offered to their clients when they move in." };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { PENDING: "Waiting for the company", APPROVED: "Approved", DECLINED: "Not accepted" };

export default async function ArtisansPage() {
  const session = await getSession();
  const [companies, mine] = await Promise.all([artisanCompanies(), session ? myArtisanApplications(session.user.id) : Promise.resolve([])]);
  return (
    <div className="stack-lg">
      <section className="art-hero">
        <div className="art-hero-copy">
          <p className="eyebrow">Artisans on Housy</p>
          <h1>Moving in is easier with <em className="hl">people you can trust.</em></h1>
          <p>Electricians, plumbers, painters, carpenters and more, registered with the property companies on Housy. When your rent or purchase closes, the company offers you its artisans, and arranges the one you need.</p>
          <div className="row">
            <a className="btn primary" href="#register">Register as an artisan</a>
            {session ? <Link className="btn" href="/me/artisans">Artisans for my home</Link> : null}
          </div>
        </div>
        <ul className="art-trades" aria-label="Trades">
          {Object.values(TRADES).slice(0, 12).map((t) => <li key={t}>{t}</li>)}
        </ul>
      </section>

      <section className="steps-3">
        <div className="step"><span>1</span><h3>Register with a company</h3><p className="muted">Choose the property company you work with. They check you and add you to their artisans.</p></div>
        <div className="step"><span>2</span><h3>Their clients move in</h3><p className="muted">When a client&apos;s rent or purchase closes, Housy offers them that company&apos;s artisans.</p></div>
        <div className="step"><span>3</span><h3>The company arranges the job</h3><p className="muted">The client says what is needed; the company sends the right artisan. Your number is never shown publicly.</p></div>
      </section>

      {mine.length ? (
        <section className="card stack" id="mine">
          <h2>My registrations</h2>
          <ul className="list-rows">{mine.map((a) => (
            <li key={a.id}><div><strong>{a.companyName}</strong><span className="muted small"> · {a.trades.map(tradeLabel).join(", ")}</span>{a.decisionNote ? <p className="small muted">{a.decisionNote}</p> : null}</div>
              <span className={`pill ${a.status === "APPROVED" ? "ok" : a.status === "DECLINED" ? "bad" : "warn"}`}>{STATUS[a.status] ?? a.status}</span></li>
          ))}</ul>
        </section>
      ) : null}

      <section className="card stack" id="register">
        <h2>Register as an artisan</h2>
        {!session ? (
          <div className="stack">
            <p className="muted">Sign in or create a free account first, so the company can reply to you.</p>
            <div className="row"><Link className="btn primary" href="/login?next=/artisans%23register">Sign in</Link><Link className="btn" href="/join?as=personal">Create a free account</Link></div>
          </div>
        ) : companies.length === 0 ? <p className="muted">No company is taking artisan registrations yet.</p> : (
          <form action={applyArtisanAction} className="stack">
            <div className="fields">
              <label className="field">Company to register with<select name="companyId" required defaultValue=""><option value="" disabled>Choose a company</option>{companies.map((c) => <option key={c.companyId} value={c.companyId}>{c.displayName}</option>)}</select></label>
              <label className="field">Your name<input name="name" required minLength={2} maxLength={80} defaultValue={session.user.name} autoComplete="name" /></label>
              <label className="field">Phone<input name="phone" type="tel" required autoComplete="tel" placeholder="0803 123 4567" /></label>
              <label className="field">Years of experience<input name="years" inputMode="numeric" maxLength={2} placeholder="5" /></label>
            </div>
            <TradePicker />
            <label className="field">Areas you work in<input name="areas" required maxLength={200} placeholder="Lekki, Ajah, Victoria Island" /></label>
            <label className="field">About your work (optional)<textarea name="bio" rows={3} maxLength={500} placeholder="What you do best, tools you have, jobs you are proud of." /></label>
            <button className="btn primary" type="submit">Send my registration</button>
          </form>
        )}
      </section>
    </div>
  );
}
