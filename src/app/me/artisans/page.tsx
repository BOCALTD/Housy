import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myArtisanCorner } from "@/lib/services/artisans";
import { MOVING_IN, REQUEST_STATUS, TRADES, tradeLabel } from "@/lib/artisan-rules";
import { formatDate } from "@/lib/dates";
import { ShowMore, sp, type SP } from "@/components/ui";
import { dismissOfferAction, rateJobAction, requestArtisanAction } from "./actions";

export const metadata = { title: "Artisans for my home" };
export const dynamic = "force-dynamic";

const TRADE_ORDER = [...MOVING_IN, ...(Object.keys(TRADES) as (keyof typeof TRADES)[]).filter((t) => !MOVING_IN.includes(t))];
const Stars = ({ n }: { n: number }) => <span className="art-stars" aria-label={`${n} out of 5 stars`}>{"★".repeat(Math.round(n))}<span aria-hidden="true">{"★".repeat(5 - Math.round(n))}</span></span>;

export default async function MyArtisansPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const { offers, requests, trade } = await myArtisanCorner(user.id, { trade: sp(s, "trade") });
  const pick = sp(s, "pick") ?? "";
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Artisans for my home</h1>
        <p className="muted">After your rent or purchase closes, the company you dealt with offers its artisans. Pick what you need: the ones who do that trade near your new home come first.</p>
      </div>
      {offers.length === 0 ? (
        <section className="card art-empty">
          <div aria-hidden="true" className="art-empty-ico">🛠️</div>
          <h2>Nothing yet</h2>
          <p className="muted">When a deal you are part of closes, the company&apos;s electricians, plumbers, painters and more show here.</p>
          <Link className="btn" href="/artisans">How artisans work</Link>
        </section>
      ) : (
        <>
          <nav className="blog-cats" aria-label="What do you need?">
            <Link href="/me/artisans" className={!trade ? "on" : ""}>Everyone</Link>
            {MOVING_IN.map((t) => <Link key={t} href={`/me/artisans?trade=${t}`} className={trade === t ? "on" : ""}>{TRADES[t]}</Link>)}
          </nav>
          {offers.map((o) => {
            const matching = trade ? o.artisans.filter((a) => a.tradeMatch) : o.artisans;
            return (
              <section key={o.id} className="card stack art-offer">
                <div className="row between">
                  <div><p className="eyebrow">From {o.companyName}</p><h2>{trade ? `${TRADES[trade as keyof typeof TRADES]}s for your home` : "Moving in? Get help from trusted artisans"}</h2>{o.place ? <p className="small muted">Matched to {o.place}</p> : null}</div>
                  <form action={dismissOfferAction}><input type="hidden" name="offerId" value={o.id} /><button className="btn small" type="submit">Hide</button></form>
                </div>
                {o.artisans.length === 0 ? <p className="muted small">The company has not listed its artisans yet. You can still ask, and they will find someone.</p>
                  : trade && matching.length === 0 ? <p className="muted small">None of {o.companyName}&apos;s listed artisans does this trade yet. Ask anyway: the company can find someone.</p>
                  : (
                    <ShowMore limit={6} noun="artisans" items={matching.map((a, i) => (
                      <article key={a.id} className={`art-card${i === 0 && (a.tradeMatch || a.areaMatch) ? " best" : ""}`}>
                        {i === 0 && (a.tradeMatch || a.areaMatch) ? <span className="art-best">Best match</span> : null}
                        <span className="art-avatar" aria-hidden="true">{a.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>
                        <strong>{a.name}{a.verified ? <span className="fm-verified" title="Passed the Housy ID check">✓ ID verified</span> : null}</strong>
                        {a.reviews ? <span className="small"><Stars n={a.stars} /> {a.stars.toFixed(1)} · {a.reviews} {a.reviews === 1 ? "rating" : "ratings"}</span> : <span className="small muted">New: no ratings yet</span>}
                        <span className="art-tags">{a.trades.map((t) => <em key={t} className={t === trade ? "on" : ""}>{tradeLabel(t)}</em>)}</span>
                        {a.areas ? <span className="small muted">Works in {a.areas}</span> : null}
                        {a.yearsExperience ? <span className="small muted">{a.yearsExperience} years&apos; experience{a.jobsDone ? ` · ${a.jobsDone} ${a.jobsDone === 1 ? "job" : "jobs"} through Housy` : ""}</span> : a.jobsDone ? <span className="small muted">{a.jobsDone} {a.jobsDone === 1 ? "job" : "jobs"} through Housy</span> : null}
                        {a.reasons.length ? <ul className="art-why" aria-label="Why this artisan">{a.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul> : null}
                        {a.bio ? <p className="small">{a.bio}</p> : null}
                        <Link className="btn small" scroll={false} href={`/me/artisans?${new URLSearchParams({ ...(trade ? { trade } : {}), pick: a.id })}#ask-${o.id}`}>Ask for {a.name.split(/\s+/)[0]}</Link>
                      </article>
                    ))} />
                  )}
                <details className="disclose" id={`ask-${o.id}`} open={o.artisans.length > 0}>
                  <summary>Ask for an artisan</summary>
                  <form action={requestArtisanAction} className="stack" style={{ marginTop: 10 }}>
                    <input type="hidden" name="offerId" value={o.id} />
                    <div className="fields">
                      <label className="field">Trade<select name="trade" required defaultValue={trade ?? ""}>
                        <option value="" disabled>What do you need?</option>
                        {TRADE_ORDER.map((t) => <option key={t} value={t}>{TRADES[t]}</option>)}
                      </select></label>
                      {o.artisans.length ? <label className="field">Artisan (optional)<select name="contractorId" key={pick} defaultValue={o.artisans.some((a) => a.id === pick) ? pick : ""}><option value="">Any suitable artisan</option>{(trade ? matching : o.artisans).map((a) => <option key={a.id} value={a.id}>{a.name}{a.verified ? " ✓" : ""}{a.reviews ? ` · ${a.stars.toFixed(1)}★` : ""}</option>)}</select></label> : null}
                      <label className="field">Preferred day (optional)<input type="date" name="preferredOn" /></label>
                    </div>
                    <label className="field">What needs doing<textarea name="note" required minLength={5} maxLength={1000} rows={3} placeholder="e.g. Fix the kitchen sockets and fit two ceiling fans." /></label>
                    <label className="field">Address (optional)<input name="address" maxLength={300} placeholder="Flat 4, 12 Admiralty Way, Lekki" /></label>
                    <button className="btn primary" type="submit">Send request</button>
                  </form>
                </details>
              </section>
            );
          })}
        </>
      )}
      {requests.length ? (
        <section className="card stack" id="requests">
          <h2>My requests</h2>
          <ul className="list-rows">{requests.map((r) => (
            <li key={r.id} className="stack" style={{ alignItems: "stretch" }}>
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div><strong>{tradeLabel(r.trade)}</strong><span className="small muted"> · {r.companyName} · {formatDate(r.createdAt)}{r.artisanName ? ` · ${r.artisanName}` : ""}</span><p className="small">{r.note}</p>{r.companyNote ? <p className="small muted">Company: {r.companyNote}</p> : null}</div>
                <span className={`pill ${r.status === "DONE" ? "ok" : r.status === "CANCELLED" ? "bad" : r.status === "ARRANGED" ? "brand" : "warn"}`}>{REQUEST_STATUS[r.status as keyof typeof REQUEST_STATUS] ?? r.status}</span>
              </div>
              {r.myStars ? <p className="small">You rated this job <Stars n={r.myStars} /></p> : r.canRate ? (
                <details className="disclose art-rate">
                  <summary>⭐ Rate {r.artisanName ?? "the artisan"}</summary>
                  <form action={rateJobAction} className="stack" style={{ marginTop: 10 }}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <fieldset className="star-pick"><legend>How was the job?</legend>
                      {[5, 4, 3, 2, 1].map((n) => <label key={n}><input type="radio" name="stars" value={n} required /><span aria-hidden="true">★</span><span className="sr-only">{n} {n === 1 ? "star" : "stars"}</span></label>)}
                    </fieldset>
                    <label className="field">A few words (optional)<textarea name="body" rows={2} maxLength={600} placeholder="On time? Tidy? Fair price? Would you use them again?" /></label>
                    <p className="small muted">The company sees your rating. Other clients see only the average, never your name.</p>
                    <button className="btn primary" type="submit">Send rating</button>
                  </form>
                </details>
              ) : null}
            </li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  );
}
