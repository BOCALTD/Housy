import Link from "next/link";
import { getSession } from "@/lib/auth";
import { artisanCompanies, myArtisanApplications } from "@/lib/services/artisans";
import { TRADES, tradeLabel } from "@/lib/artisan-rules";
import { TradePicker } from "@/components/TradePicker";
import { PhoneField } from "@/components/PhoneField";
import { applyArtisanAction, submitArtisanIdAction } from "./actions";
import { ID_TYPES, myFlatmateCheck } from "@/lib/services/flatmates";
import { IdCheckForm } from "@/components/IdCheckForm";

export const metadata = { title: "Artisans", description: "Electricians, plumbers, painters, carpenters and more, registered with property companies on Housy and offered to their clients when they move in." };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { PENDING: "Waiting for the company", APPROVED: "Approved", DECLINED: "Not accepted" };

export default async function ArtisansPage() {
  const session = await getSession();
  const [companies, mine, check] = await Promise.all([artisanCompanies(), session ? myArtisanApplications(session.user.id) : Promise.resolve([]), session ? myFlatmateCheck(session.user.id).catch(() => null) : Promise.resolve(null)]);
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
        <div className="step"><span>3</span><h3>Get chosen, get rated</h3><p className="muted">Clients see the artisans who do their trade in their area first. Verified IDs and good ratings move you up. Your number is never shown publicly.</p></div>
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

      {session && (mine.length || check) ? (
        <section className="card stack art-verify" id="verify">
          <div className="row between">
            <div><h2>Verified artisan badge</h2><p className="muted small">Pass the Housy ID check and clients see <strong>✓ ID verified</strong> next to your name. Verified artisans are shown higher to clients who need your trade.</p></div>
            {check?.status === "VERIFIED" ? <span className="pill ok">✓ ID verified</span> : check?.status === "PENDING" ? <span className="pill warn">Being checked</span> : null}
          </div>
          {check?.status === "VERIFIED" ? <p className="small muted">Your badge shows to every company&apos;s clients you are offered to.</p>
            : check?.status === "PENDING" ? <p className="small muted">A Housy reviewer is comparing your ID and selfie. You will get a notification with the result.</p>
            : (
              <>
                {check?.status === "REJECTED" && check.note ? <p className="flash error" role="alert">Last time: {check.note}</p> : null}
                <p className="small muted">A photo of a government ID and a selfie. Only Housy reviewers see them, and they are deleted 30 days after the decision. Clients never see your ID.</p>
                <IdCheckForm types={ID_TYPES} action={submitArtisanIdAction} />
              </>
            )}
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
              <PhoneField label="Phone" required />
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
