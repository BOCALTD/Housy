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
import { avatarsFor } from "@/lib/services/avatars";

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
  const avatars = await avatarsFor(rows.filter((r) => r.kind === "AGENT").map((r) => r.targetId)).catch(() => new Map<string, string>());
  const tab = TABS.find((t) => t.kind === kind)!;
  return (
    <div className="stack-lg">
      <section className={`dir-hero k-${kind}`}>
        <div className="dir-hero-orbs" aria-hidden="true"><i /><i /><i /></div>
        <p className="eyebrow">Directory</p>
        <h1>{kind === "agents" ? "Agents you can trust" : kind === "companies" ? "Property companies near you" : "Developers building what's next"}</h1>
        <p>Only people and companies that chose to be listed appear here. Check trust levels and reviews from real closed deals. Following them shares nothing about you.</p>
        <form method="get" className="blog-search" role="search"><input type="hidden" name="kind" value={kind} /><input name="q" type="search" defaultValue={q} placeholder={`Search ${tab.label.toLowerCase()} by name`} aria-label="Search by name" /><button className="btn primary" type="submit">Search</button></form>
      </section>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <nav className="blog-cats" aria-label="Directory">{TABS.map((t) => <Link key={t.kind} href={`/directory?kind=${t.kind}`} className={t.kind === kind ? "on" : ""} aria-current={t.kind === kind ? "page" : undefined}>{t.kind === "agents" ? "👤" : t.kind === "companies" ? "🏢" : "🏗️"} {t.label}</Link>)}</nav>
      {rows.length === 0 ? (
        <section className="card art-empty"><div className="art-empty-ico" aria-hidden="true">{kind === "agents" ? "👤" : "🏢"}</div><h2>{q ? "Nobody matches that name" : "Nobody is listed here yet"}</h2><p className="muted">{q ? "Check the spelling or try part of the name." : "Listed agents and companies will appear here."}</p>{q ? <Link className="btn primary" href={`/directory?kind=${kind}`}>Clear search</Link> : <Link className="btn primary" href={`/join?as=${kind === "agents" ? "agent" : "company"}`}>{kind === "agents" ? "Join as an agent" : "Register a company"}</Link>}</section>
      ) : (
        <ul className="dir-grid">{rows.map((r, i) => {
          const rep = reps.get(r.targetId);
          const href = r.kind === "AGENT" ? `/agents/${r.targetId}` : `/companies/${r.targetId}`;
          const pic = r.kind === "AGENT" ? avatars.get(r.targetId) : undefined;
          return (
            <li key={`${r.kind}-${r.targetId}`} className="dir-card" style={{ ["--i" as string]: i, ["--h" as string]: `${(r.name.charCodeAt(0) * 37) % 360}` }}>
              <div className="dir-band" aria-hidden="true" />
              <Link href={href} className="dir-face" aria-label={`Open ${r.name}`}>{pic ? <img src={pic} alt="" /> : <span>{r.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>}</Link>
              <div className="dir-body">
                <strong className="dir-name"><Link href={href}>{r.name}</Link></strong>
                <span className="small muted">{r.sub}</span>
                <div className="dir-badges">{trusts.get(r.targetId) ? <TrustBadge t={trusts.get(r.targetId)!} /> : null}{r.kind !== "AGENT" ? <GoldBadge tier={tiers.get(r.targetId) ?? "BASIC"} /> : null}</div>
                {r.blurb ? <p className="small dir-blurb">{r.blurb}</p> : null}
                <div className="dir-stats">
                  <span><b>{r.followers}</b> {r.followers === 1 ? "follower" : "followers"}</span>
                  {rep?.reviewCount ? <span><b>★ {rep.average.toFixed(1)}</b> · {rep.reviewCount} {rep.reviewCount === 1 ? "review" : "reviews"}</span> : <span className="muted">No reviews yet</span>}
                </div>
                <BadgeRow badges={rep?.badges ?? []} />
                {awards.get(r.targetId)?.[0] ? <PlaqueBadge plaque={awards.get(r.targetId)![0].plaque} month={awards.get(r.targetId)![0].month} /> : null}
              </div>
              <div className="dir-actions">
                <Link className="btn primary" href={href}>View profile</Link>
                {session ? (
                  <>
                    {r.kind === "AGENT" && r.acceptsMessages && r.targetId !== session.user.id ? <Link className="btn" href={`/messages/new?to=${r.targetId}`}>Message</Link> : null}
                    <form action={r.following ? unfollowAction : followAction}>
                      <input type="hidden" name="kind" value={r.kind} /><input type="hidden" name="targetId" value={r.targetId} /><input type="hidden" name="back" value={back} />
                      <button className={`btn${r.following ? "" : " follow"}`} type="submit">{r.following ? "Following ✓" : "＋ Follow"}</button>
                    </form>
                    {r.kind === "AGENT" && !member && r.targetId !== session.user.id ? <Link className="btn" href={`/me/collaborations/new?agent=${r.targetId}`}>Collaborate</Link> : null}
                    {r.kind !== "AGENT" && inviteCompany && r.targetId !== member?.companyId ? <Link className="btn" href={`/app/collaborations/new?company=${r.targetId}`}>Collaborate</Link> : null}
                  </>
                ) : <Link className="btn" href={`/login?next=${encodeURIComponent(back)}`}>Sign in to follow</Link>}
              </div>
            </li>
          );
        })}</ul>
      )}
      {page > 1 || more ? (
        <div className="row between">
          {page > 1 ? <Link className="btn" href={link({ page: page - 1 })}>← Previous</Link> : <span />}
          {more ? <Link className="btn primary" href={link({ page: page + 1 })}>Next →</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
