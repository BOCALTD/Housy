import { trustMany } from "@/lib/services/kyc";
import { TrustBadge } from "@/components/TrustBadge";
import Link from "next/link";
import { getMember, getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { directory, type DirectoryKind } from "@/lib/services/community";
import { tiersFor } from "@/lib/services/tiers";
import { GoldBadge } from "@/components/Promo";
import { reputationMany } from "@/lib/services/reviews";
import { awardsFor } from "@/lib/services/awards";
import { PlaqueBadge } from "@/components/Awards";
import { BadgeRow } from "@/components/Reputation";
import { Flash, sp, type SP } from "@/components/ui";
import { followAction, unfollowAction } from "../me/actions";

export const metadata = { title: "Agents, companies and developers" };
export const dynamic = "force-dynamic";

const TABS: { kind: DirectoryKind; label: string }[] = [{ kind: "agents", label: "Agents" }, { kind: "companies", label: "Companies" }, { kind: "developers", label: "Developers" }];

export default async function DirectoryPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const session = await getSession();
  const member = session ? await getMember() : null;
  const inviteCompany = !!member && can(member.role, "collab.company");
  const kind = (TABS.find((t) => t.kind === sp(searchParams, "kind"))?.kind ?? "agents") as DirectoryKind;
  const q = sp(searchParams, "q") ?? "";
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const { rows, more } = await directory({ kind, q, page, viewerId: session?.user.id ?? null });
  const tiers = await tiersFor(rows.filter((r) => r.kind !== "AGENT").map((r) => r.targetId));
  const reps = new Map([...(await reputationMany("AGENT", rows.filter((r) => r.kind === "AGENT").map((r) => r.targetId))), ...(await reputationMany("COMPANY", rows.filter((r) => r.kind !== "AGENT").map((r) => r.targetId)))]);
  const trusts = new Map([...(await trustMany("AGENT", rows.filter((r) => r.kind === "AGENT").map((r) => r.targetId))), ...(await trustMany("COMPANY", rows.filter((r) => r.kind !== "AGENT").map((r) => r.targetId)))]);
  const awards = await awardsFor(rows.filter((r) => r.kind === "AGENT").map((r) => r.targetId));
  const link = (over: Record<string, string | number>) => { const u = new URLSearchParams({ kind, ...(q ? { q } : {}), page: String(page), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) }); return `/directory?${u}`; };
  const back = link({});
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Agents, companies and developers</h1><p className="muted">Only people and companies that chose to be listed appear here. Following them gives you their updates and gives them no access to your details.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <nav className="nav" aria-label="Directory">{TABS.map((t) => <Link key={t.kind} href={`/directory?kind=${t.kind}`} aria-current={t.kind === kind ? "page" : undefined}>{t.label}</Link>)}</nav>
      <form method="get" className="row"><input type="hidden" name="kind" value={kind} /><input name="q" defaultValue={q} placeholder="Search by name" aria-label="Search by name" /><button className="btn" type="submit">Search</button></form>
      <section className="card">
        {rows.length === 0 ? <p className="muted">Nobody is listed here yet.</p> : (
          <ul className="timeline">{rows.map((r) => (
            <li key={`${r.kind}-${r.targetId}`}><div className="row between" style={{ width: "100%" }}>
              <div><strong><Link href={r.kind === "AGENT" ? `/agents/${r.targetId}` : `/companies/${r.targetId}`}>{r.name}</Link></strong> {trusts.get(r.targetId) ? <TrustBadge t={trusts.get(r.targetId)!} /> : null} {r.kind !== "AGENT" ? <GoldBadge tier={tiers.get(r.targetId) ?? "BASIC"} /> : null} <span className="small muted">{r.sub}</span>{r.blurb ? <div className="small muted">{r.blurb}</div> : null}<div className="small muted">{r.followers} {r.followers === 1 ? "follower" : "followers"}{reps.get(r.targetId)?.reviewCount ? ` · ${reps.get(r.targetId)!.average.toFixed(1)} out of 5 from ${reps.get(r.targetId)!.reviewCount} reviews` : ""}</div><BadgeRow badges={reps.get(r.targetId)?.badges ?? []} />{awards.get(r.targetId)?.[0] ? <div><PlaqueBadge plaque={awards.get(r.targetId)![0].plaque} month={awards.get(r.targetId)![0].month} /></div> : null}</div>
              {session ? (
                <div className="row">
                  {r.kind === "AGENT" && r.acceptsMessages && r.targetId !== session.user.id ? <Link className="btn" href={`/messages/new?to=${r.targetId}`}>Message</Link> : null}
                  {r.kind === "AGENT" && !member && r.targetId !== session.user.id ? <Link className="btn" href={`/me/collaborations/new?agent=${r.targetId}`}>Invite to collaborate</Link> : null}
                  {r.kind !== "AGENT" && inviteCompany && r.targetId !== member?.companyId ? <Link className="btn" href={`/app/collaborations/new?company=${r.targetId}`}>Invite to collaborate</Link> : null}
                <form action={r.following ? unfollowAction : followAction}>
                  <input type="hidden" name="kind" value={r.kind} /><input type="hidden" name="targetId" value={r.targetId} /><input type="hidden" name="back" value={back} />
                  <button className="btn" type="submit">{r.following ? "Unfollow" : "Follow"}</button>
                </form>
                </div>
              ) : <Link className="btn" href="/login">Sign in to follow</Link>}
            </div></li>))}</ul>
        )}
        <div className="row between">
          {page > 1 ? <Link className="btn" href={link({ page: page - 1 })}>Previous</Link> : <span />}
          {more ? <Link className="btn" href={link({ page: page + 1 })}>Next</Link> : <span />}
        </div>
      </section>
    </div>
  );
}
