import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { leaderboard, myDispute, publishedMonths } from "@/lib/services/awards";
import { monthLabel, windowOver, type AwardConfig, type Plaque } from "@/lib/award-rules";
import { formatDate } from "@/lib/dates";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { PlaqueBadge } from "@/components/Awards";
import { awardDisputeAction } from "../actions";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: { month: string } }) {
  return { title: `Top Agents, ${/^\d{4}-\d{2}$/.test(params.month) ? monthLabel(params.month) : "month"}` };
}

export default async function AwardMonthPage({ params, searchParams }: { params: { month: string }; searchParams?: SP }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) notFound();
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [lb, months, session] = await Promise.all([leaderboard(params.month, page), publishedMonths(), getSession()]);
  if (!lb) notFound();
  const cfg = lb.run.config as unknown as AwardConfig;
  const here = `/awards/${params.month}`;
  const mine = session ? lb.rows.find((r) => r.userId === session.user.id) : null;
  const dispute = session && lb.run.status === "PUBLISHED" ? await myDispute(session.user.id, lb.run.id) : null;
  const open = lb.run.status === "PUBLISHED" && lb.run.publishedAt && !windowOver(lb.run.publishedAt, cfg.windowDays, new Date());
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Top Agent of the Month: {monthLabel(params.month)}</h1>
        <p className="muted">{lb.run.status === "FROZEN" ? "This ranking is final." : `Published ${lb.run.publishedAt ? formatDate(lb.run.publishedAt) : ""}. It can still be corrected for ${cfg.windowDays} days after publication.`}</p>
        <details className="inline"><summary>How the ranking works</summary>
          <p className="small">Three things are counted for the month: verified completed sales, listings the platform approved, and published verified reviews. Each is scaled so a large count cannot drown the others, then combined: sales {cfg.weights.sales}%, posts {cfg.weights.posts}%, ratings {cfg.weights.rating}%. An agent needs at least {cfg.minSales} verified {cfg.minSales === 1 ? "sale" : "sales"}, {cfg.minPosts} {cfg.minPosts === 1 ? "post" : "posts"} and {cfg.minReviews} reviews. Paid plans, promotions and advertising do not count.</p></details>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Leaderboard ({lb.total})</h2>
        {lb.rows.length === 0 ? <p className="muted">No agent met the requirements this month.</p> : (
          <ul className="timeline">{lb.rows.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
              <div className="row between"><div><strong>#{r.rank}</strong> <Link href={`/agents/${r.userId}`}>{r.displayName}</Link> <span className="small muted">{r.companyName}</span></div><strong>{r.score.toFixed(1)}</strong></div>
              {r.plaque ? <PlaqueBadge plaque={r.plaque as Plaque} month={params.month} /> : null}
              <details className="inline"><summary>Breakdown</summary>
                <ul className="timeline"><li>Verified sales: {r.sales}</li><li>Approved posts: {r.posts}</li><li>Reviews: {r.reviews}, average {r.avgRating.toFixed(1)}</li>
                  <li>Scaled: sales {Math.round(r.normSales * 100)}%, posts {Math.round(r.normPosts * 100)}%, rating {Math.round(r.normRating * 100)}%</li></ul></details>
            </div></li>))}</ul>
        )}
        <div className="row between">
          {lb.page > 0 ? <Link className="btn" href={`${here}?page=${lb.page - 1}`}>Previous</Link> : <span />}
          {lb.page + 1 < lb.pages ? <Link className="btn" href={`${here}?page=${lb.page + 1}`}>Next</Link> : <span />}
        </div>
      </section>
      {session && open && !dispute ? (
        <section className="card stack"><h2>Think a figure is wrong?</h2>
          <details className="inline"><summary>Dispute this ranking</summary>
            <form action={awardDisputeAction} className="stack"><input type="hidden" name="runId" value={lb.run.id} /><input type="hidden" name="month" value={params.month} />
              <Field label="What is wrong, and which deals, posts or reviews are missing or counted wrongly?"><textarea name="reason" rows={4} required minLength={10} maxLength={1000} /></Field>
              <button className="btn" type="submit">Send to the platform team</button></form></details>
          {mine ? null : <p className="small muted">You can dispute only if you appear in this ranking.</p>}
        </section>
      ) : null}
      {dispute ? <p className="small">Your dispute is {dispute.status.toLowerCase()}{dispute.decision ? `: ${dispute.decision}` : ""}.</p> : null}
      <section className="card stack"><h2>Other months</h2>
        <ShowMore noun="more months" limit={6} items={months.filter((m) => m.month !== params.month).map((m) => <li key={m.id}><Link href={`/awards/${m.month}`}>{monthLabel(m.month)}</Link></li>)} /></section>
    </div>
  );
}
