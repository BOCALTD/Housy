import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { myReferrals } from "@/lib/services/referrals";
import { activePolicies, EVENT_LABELS } from "@/lib/services/rewards";
import { listCampaigns } from "@/lib/services/referrals";
import { campaignOpen } from "@/lib/reward-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Refer and earn" };
export const dynamic = "force-dynamic";

export default async function ReferralsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const [r, policies, campaigns] = await Promise.all([myReferrals(user.id, page), activePolicies(user.id, "REFERRAL"), listCampaigns(user.id)]);
  const h = (await headers());
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const now = new Date();
  const open = campaigns.filter((c) => campaignOpen(c, now));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Refer and earn</h1><p className="muted">Share your link. A reward opens only when the person you referred does what the campaign asks, within its time limit. <Link href="/rewards">My rewards</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack"><h2>Your link</h2>
        <p><code>{origin}/r/{r.code}</code></p>
        <p className="small muted">For a company, add <code>?for=company</code>. The link counts visits, nothing more: it does not record who visited. It is remembered for the campaign&apos;s window in one first-party cookie.</p>
      </section>
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{r.clicks}</b><span>Link visits</span></div>
        <div className="stat"><b>{r.total}</b><span>Sign-ups</span></div>
        <div className="stat"><b>{r.counts.QUALIFIED ?? 0}</b><span>Qualified</span></div>
        <div className="stat"><b>{r.conversion}%</b><span>Conversion</span></div>
      </section>
      <section className="card"><h2>What earns a reward</h2>
        {open.length === 0 ? <p className="muted">No campaign is open right now.</p> : (
          <ShowMore noun="more campaigns" limit={3} items={open.map((c) => {
            const p = policies.find((x) => x.campaignId === c.id);
            return <li key={c.id}><div className="stack" style={{ gap: 2 }}><strong>{c.name}</strong><span className="small">{EVENT_LABELS[c.event]} within {c.qualifyWithinDays} days of sign-up. {p ? `Reward: ${formatKobo(p.amountKobo)}, paid after ${p.holdDays} days if everything checks out.` : "The reward amount has not been set yet."}</span><span className="small muted">Open to {humanize(c.audience).toLowerCase()} sign-ups{c.endsOn ? ` until ${formatDate(c.endsOn)}` : ""}. Link valid for {c.attributionDays} days after a visit.{c.maxRewardsPerReferrer ? ` At most ${c.maxRewardsPerReferrer} rewards each.` : ""}</span>{p?.terms ? <details className="inline"><summary>Terms</summary><p className="small">{p.terms}</p></details> : null}</div></li>;
          })} />
        )}
      </section>
      <section className="card"><h2>People you referred</h2>
        {r.items.length === 0 ? <p className="muted">Nobody yet. Names are shortened so you can tell referrals apart without learning more than the person chose to share.</p> : (
          <ul className="timeline">{r.items.map((i) => (
            <li key={i.id}><div className="row between"><strong>{i.who}</strong><Pill status={i.status} /></div>
              <div className="small muted">{i.campaign} · signed up {formatDate(i.registeredAt)}</div>
              <div className="small">{i.why}</div>
              {i.underCheck ? <div className="small muted">This sign-up is being checked by a person. That is routine when something looks unusual, and is not a finding against you.</div> : null}
            </li>))}</ul>
        )}
        <div className="row">{page > 1 ? <Link className="btn" href={`/referrals?page=${page - 1}`}>Previous</Link> : null}{r.more ? <Link className="btn" href={`/referrals?page=${page + 1}`}>Next</Link> : null}</div>
      </section>
    </div>
  );
}
