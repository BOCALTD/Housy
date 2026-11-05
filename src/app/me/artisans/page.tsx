import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myArtisanCorner } from "@/lib/services/artisans";
import { MOVING_IN, REQUEST_STATUS, TRADES, tradeLabel } from "@/lib/artisan-rules";
import { formatDate } from "@/lib/dates";
import { dismissOfferAction, requestArtisanAction } from "./actions";

export const metadata = { title: "Artisans for my home" };
export const dynamic = "force-dynamic";

export default async function MyArtisansPage() {
  const user = await requireUser();
  const { offers, requests } = await myArtisanCorner(user.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Artisans for my home</h1>
        <p className="muted">After your rent or purchase closes, the company you dealt with offers its artisans. Say what you need and they arrange it.</p>
      </div>
      {offers.length === 0 ? (
        <section className="card art-empty">
          <div aria-hidden="true" className="art-empty-ico">🛠️</div>
          <h2>Nothing yet</h2>
          <p className="muted">When a deal you are part of closes, the company&apos;s electricians, plumbers, painters and more show here.</p>
          <Link className="btn" href="/artisans">How artisans work</Link>
        </section>
      ) : offers.map((o) => (
        <section key={o.id} className="card stack art-offer">
          <div className="row between">
            <div><p className="eyebrow">From {o.companyName}</p><h2>Moving in? Get help from trusted artisans</h2></div>
            <form action={dismissOfferAction}><input type="hidden" name="offerId" value={o.id} /><button className="btn small" type="submit">Hide</button></form>
          </div>
          {o.artisans.length ? (
            <ul className="art-cards">{o.artisans.map((a) => (
              <li key={a.id} className="art-card">
                <span className="art-avatar" aria-hidden="true">{a.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>
                <strong>{a.name}</strong>
                <span className="art-tags">{a.trades.map((t) => <em key={t}>{tradeLabel(t)}</em>)}</span>
                {a.areas ? <span className="small muted">Works in {a.areas}</span> : null}
                {a.yearsExperience ? <span className="small muted">{a.yearsExperience} years&apos; experience</span> : null}
                {a.bio ? <p className="small">{a.bio}</p> : null}
              </li>
            ))}</ul>
          ) : <p className="muted small">The company has not listed its artisans yet. You can still ask, and they will find someone.</p>}
          <details className="disclose" open={o.artisans.length > 0}>
            <summary>Ask for an artisan</summary>
            <form action={requestArtisanAction} className="stack" style={{ marginTop: 10 }}>
              <input type="hidden" name="offerId" value={o.id} />
              <div className="fields">
                <label className="field">Trade<select name="trade" required defaultValue="">
                  <option value="" disabled>What do you need?</option>
                  {MOVING_IN.map((t) => <option key={t} value={t}>{TRADES[t]}</option>)}
                  {(Object.keys(TRADES) as (keyof typeof TRADES)[]).filter((t) => !MOVING_IN.includes(t)).map((t) => <option key={t} value={t}>{TRADES[t]}</option>)}
                </select></label>
                {o.artisans.length ? <label className="field">Artisan (optional)<select name="contractorId" defaultValue=""><option value="">Any suitable artisan</option>{o.artisans.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : null}
                <label className="field">Preferred day (optional)<input type="date" name="preferredOn" /></label>
              </div>
              <label className="field">What needs doing<textarea name="note" required minLength={5} maxLength={1000} rows={3} placeholder="e.g. Fix the kitchen sockets and fit two ceiling fans." /></label>
              <label className="field">Address (optional)<input name="address" maxLength={300} placeholder="Flat 4, 12 Admiralty Way, Lekki" /></label>
              <button className="btn primary" type="submit">Send request</button>
            </form>
          </details>
        </section>
      ))}
      {requests.length ? (
        <section className="card stack" id="requests">
          <h2>My requests</h2>
          <ul className="list-rows">{requests.map((r) => (
            <li key={r.id}>
              <div><strong>{tradeLabel(r.trade)}</strong><span className="small muted"> · {r.companyName} · {formatDate(r.createdAt)}</span><p className="small">{r.note}</p>{r.companyNote ? <p className="small muted">Company: {r.companyNote}</p> : null}</div>
              <span className={`pill ${r.status === "DONE" ? "ok" : r.status === "CANCELLED" ? "bad" : r.status === "ARRANGED" ? "brand" : "warn"}`}>{REQUEST_STATUS[r.status as keyof typeof REQUEST_STATUS] ?? r.status}</span>
            </li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  );
}
