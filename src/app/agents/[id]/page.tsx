import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureReputation, publicAgent, publicReviews } from "@/lib/services/reviews";
import { BADGES, CATEGORIES, type BadgeKey } from "@/lib/reputation-rules";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { awardsFor } from "@/lib/services/awards";
import { PlaqueBadge } from "@/components/Awards";
import { BadgeRow, ReviewCard, ScoreLine } from "@/components/Reputation";
import { reportReviewAction } from "../../reviews/actions";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: { id: string } }) {
  const a = await publicAgent(params.id);
  return { title: a ? a.displayName : "Agent not available" };
}

export default async function AgentPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const agent = await publicAgent(params.id);
  if (!agent) notFound();
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [rep, list, session] = await Promise.all([ensureReputation("AGENT", agent.userId), publicReviews("AGENT", agent.userId, page), getSession()]);
  const awards = (await awardsFor([agent.userId])).get(agent.userId) ?? [];
  const badges = (rep?.badges as string[] | undefined) ?? [];
  const comps = (rep?.components as Record<string, number> | undefined) ?? {};
  const here = `/agents/${agent.userId}`;
  return (
    <div className="stack-lg">
      <div className="card stack">
        <p className="eyebrow">Agent{agent.companyName ? ` at ${agent.companyName}` : ""}</p>
        <h1>{agent.displayName}</h1>
        {agent.headline ? <p className="muted">{agent.headline}</p> : null}
        <ScoreLine score={rep?.score ?? 0} count={rep?.reviewCount ?? 0} average={rep?.average ?? 0} />
        <BadgeRow badges={badges} />
        {awards.length ? <ShowMore noun="more awards" limit={3} items={awards.map((a) => <li key={a.month}><PlaqueBadge plaque={a.plaque} month={a.month} /></li>)} /> : null}
        {agent.bio ? <p style={{ whiteSpace: "pre-line", maxWidth: "65ch" }}>{agent.bio}</p> : null}
        <details className="inline"><summary>How reputation is worked out</summary>
          <p className="small">Built from verified reviews (newer and better-evidenced ones count more), how quickly new conversations are answered, completed deals, and complaints that were upheld. Paid plans, promotions and advertising are not part of it.</p>
          <ul className="timeline">
            <li>Reviews: {comps.reviews ?? 0}/100</li><li>Responsiveness: {comps.responsiveness ?? 0}/100</li><li>Experience: {comps.experience ?? 0}/100</li>
            {comps.complaintPenalty ? <li>Upheld complaints: −{comps.complaintPenalty}</li> : null}
          </ul>
          {badges.length ? <ul className="timeline">{badges.map((b) => <li key={b}><strong>{BADGES[b as BadgeKey]?.label}</strong>: {BADGES[b as BadgeKey]?.how}</li>)}</ul> : null}
        </details>
        <div className="row">
          {agent.acceptsMessages && session && session.user.id !== agent.userId ? <Link className="btn primary" href={`/messages/new?to=${agent.userId}`}>Message</Link> : null}
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Reviews ({list.total})</h2>
        <p className="small muted">Every review here is tied to a real conversation, viewing or deal. Areas rated: {CATEGORIES.map((c) => c.label).join(", ").toLowerCase()}.</p>
        {list.rows.length === 0 ? <p className="muted">No reviews yet.</p> : (
          <ul className="timeline">{list.rows.map((r) => (
            <li key={r.id}><ReviewCard r={r} report={session && session.user.id !== agent.userId ? (
              <details className="inline"><summary>Report this review</summary>
                <form action={reportReviewAction} className="stack"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} />
                  <Field label="What is wrong with it?"><input name="reason" required minLength={5} maxLength={500} /></Field><button className="btn" type="submit">Report</button></form></details>
            ) : null} /></li>))}</ul>
        )}
        <div className="row between">
          {list.page > 0 ? <Link className="btn" href={`${here}?page=${list.page - 1}`}>Previous</Link> : <span />}
          {list.page + 1 < list.pages ? <Link className="btn" href={`${here}?page=${list.page + 1}`}>Next</Link> : <span />}
        </div>
      </section>
    </div>
  );
}
