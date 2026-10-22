import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { myMatches } from "@/lib/services/flatmates";
import { BANDS, INTENTS } from "@/lib/flatmate-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Flash, Pager, sp, type SP } from "@/components/ui";
import { MatchBadge } from "@/components/MatchBadge";
import { hideAction } from "../actions";

export const metadata = { title: "Flatmate matches" };
export const dynamic = "force-dynamic";

export default async function MatchesPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const min = Number(sp(s, "min") ?? 0);
  const page = Math.max(1, Number(sp(s, "page") ?? 1) || 1);
  const r = await myMatches(user.id, { minScore: [0, 40, 65, 85].includes(min) ? min : 0, page });
  if (!r.me) redirect("/flatmates/profile");
  const href = (p: number) => `/flatmates/matches?${new URLSearchParams({ ...(min ? { min: String(min) } : {}), page: String(p) }).toString()}`;
  return (
    <div className="stack-lg">
      <div className="portal-head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">Flatmates · {r.me.city}</p>
          <h1>Your matches</h1>
          <p className="muted small">{r.me.status === "ACTIVE" ? `${r.total} ${r.total === 1 ? "person" : "people"} you could share with, best match first.` : "Your profile is paused, so you are not seeing matches."}</p>
        </div>
        <div className="row"><Link className="btn" href="/flatmates/profile">Edit my profile</Link><Link className="btn" href="/flatmates/requests">Requests and rooms</Link></div>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <nav className="nav workspace-nav" aria-label="Show">
        <Link className="tap" href="/flatmates/matches" aria-current={!min ? "page" : undefined}>Everyone</Link>
        {BANDS.slice(0, 3).map((b) => <Link key={b.min} className="tap" href={`/flatmates/matches?min=${b.min}`} aria-current={min === b.min ? "page" : undefined}>{b.label}{b.min < 85 ? " and better" : ""}</Link>)}
      </nav>
      {r.rows.length === 0 ? (
        <section className="card stack"><h2>No matches yet</h2><p className="muted">Nobody else in {r.me.city} fits yet. New people join every day: check back, or widen your budget or the people you&apos;d share with.</p></section>
      ) : (
        <ul className="fm-grid">
          {r.rows.map((m) => (
            <li key={m.profile.userId} className="card fm-card">
              <div className="fm-card-top">
                <MatchBadge score={m.match.score} />
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong className="fm-name">{m.profile.displayName}</strong>
                  <span className="small muted">{[m.profile.ageBand, m.profile.gender ? m.profile.gender.toLowerCase().replace("_", "-") : "", m.profile.occupation].filter(Boolean).join(" · ")}</span>
                  <span className="small">{INTENTS[m.profile.intent]}</span>
                </div>
              </div>
              <p className="small muted">{formatKobo(m.profile.budgetMinKobo)}–{formatKobo(m.profile.budgetMaxKobo)} a month · from {formatDate(m.profile.moveInFrom)}{m.profile.areas ? ` · ${m.profile.areas}` : ""}</p>
              {m.match.dealbreaker ? <p className="small fm-bad">{m.match.dealbreaker}</p> : null}
              <ul className="fm-reasons">
                {m.match.good.slice(0, 3).map((g) => <li key={g} className="fm-good">{g}</li>)}
                {m.match.bad.slice(0, 2).map((b) => <li key={b} className="fm-bad">{b}</li>)}
              </ul>
              <div className="row" style={{ marginTop: "auto" }}>
                <Link className="btn primary" href={`/flatmates/p/${m.profile.userId}`}>{m.request?.status === "ACCEPTED" ? "Matched: open" : m.request?.status === "PENDING" ? (m.request.mine ? "Request sent" : "They asked you: answer") : "View and request"}</Link>
                <form action={hideAction}><input type="hidden" name="userId" value={m.profile.userId} /><button className="btn" type="submit">Hide</button></form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={r.total} pageSize={20} href={href} noun="matches" />
    </div>
  );
}
