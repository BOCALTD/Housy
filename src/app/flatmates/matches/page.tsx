import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { myMatches } from "@/lib/services/flatmates";
import { avatarUrlFor } from "@/lib/services/profile";
import { BANDS, INTENTS, SPACES } from "@/lib/flatmate-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Flash, Pager, sp, type SP } from "@/components/ui";
import { MatchBadge } from "@/components/MatchBadge";
import { hideAction } from "../actions";

export const metadata = { title: "Flatmate matches" };
export const dynamic = "force-dynamic";

const SORTS = { best: "Best match first", newest: "Newest profiles", soonest: "Moving in soonest" } as const;

export default async function MatchesPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const min = Number(sp(s, "min") ?? 0);
  const page = Math.max(1, Number(sp(s, "page") ?? 1) || 1);
  const verified = sp(s, "verified") === "1";
  const space = sp(s, "space") ?? "";
  const sort = (sp(s, "sort") ?? "best") as keyof typeof SORTS;
  const [r, avatar] = await Promise.all([
    myMatches(user.id, { minScore: [0, 40, 65, 85].includes(min) ? min : 0, page, verified, space: space in SPACES ? space : undefined, sort: sort in SORTS ? sort : "best" }),
    avatarUrlFor(user.id).catch(() => null),
  ]);
  if (!r.me) redirect("/flatmates/profile");
  const me = r.me;
  const q = (over: Record<string, string>) => `/flatmates/matches?${new URLSearchParams({ ...(min ? { min: String(min) } : {}), ...(verified ? { verified: "1" } : {}), ...(space ? { space } : {}), ...(sort !== "best" ? { sort } : {}), ...over }).toString()}`;
  // Profile strength: what makes other people trust and pick you.
  const steps = [
    { done: !!avatar, label: "Profile photo", href: "/me/settings" },
    { done: r.meVerified, label: "Flatmate ID check", href: "/flatmates/profile#verify" },
    { done: me.about.length >= 40, label: "A few words about you", href: "/flatmates/profile" },
    { done: me.spaces.length > 0, label: "The kind of space", href: "/flatmates/profile" },
    { done: me.amenities.length > 0, label: "Your must-haves", href: "/flatmates/profile" },
    { done: !!me.areas, label: "Areas you like", href: "/flatmates/profile" },
    { done: !!me.occupation, label: "Occupation", href: "/flatmates/profile" },
  ];
  const strength = Math.round((steps.filter((x) => x.done).length / steps.length) * 100);
  return (
    <div className="stack-lg">
      <section className="engine">
        <div className="engine-radar" aria-hidden="true">
          <div className="radar-sweep" />
          <span className="radar-ring r1" /><span className="radar-ring r2" /><span className="radar-ring r3" />
          {Array.from({ length: Math.min(9, r.stats.eligible) }).map((_, i) => <i key={i} className="radar-blip" style={{ ["--a" as string]: `${(i * 137) % 360}deg`, ["--d" as string]: `${30 + ((i * 53) % 62)}`, ["--t" as string]: `${(i * 0.37) % 3}s` }} />)}
          <span className="radar-core">{avatar ? <img src={avatar} alt="" /> : me.displayName.slice(0, 1)}</span>
        </div>
        <div className="engine-copy">
          <p className="eyebrow">Match engine · {me.city}</p>
          <h1>{me.status === "ACTIVE" ? <>We found <em className="hl">{r.stats.eligible}</em> {r.stats.eligible === 1 ? "person" : "people"} you could share with</> : "Your profile is paused"}</h1>
          <p className="muted">Scored on how you live, budget, move-in date, the kind of space and your must-haves. Deal-breakers and who you&apos;d share with are checked first.</p>
          <div className="engine-stats">
            <div><b>{r.stats.scanned}</b><span>profiles in {me.city}</span></div>
            <div><b>{r.stats.perfect}</b><span>perfect matches</span></div>
            <div><b>{r.stats.excellent}</b><span>excellent</span></div>
            <div><b>{r.stats.verified}</b><span>ID-verified</span></div>
            <Link href="/flatmates/requests"><b>{r.stats.pending}</b><span>asking you</span></Link>
          </div>
        </div>
        <div className="engine-strength">
          <div className="strength-ring" style={{ ["--pct" as string]: `${strength}` }}><span>{strength}%</span></div>
          <strong>Profile strength</strong>
          <ul>{steps.map((x) => <li key={x.label} className={x.done ? "done" : ""}>{x.done ? <span>✓ {x.label}</span> : <Link href={x.href}>+ {x.label}</Link>}</li>)}</ul>
        </div>
      </section>

      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />

      <form method="get" className="engine-filters" aria-label="Filter matches">
        <div className="choice-row">
          <label className="chip-choice"><input type="radio" name="min" value="0" defaultChecked={!min} /><span>Everyone</span></label>
          {BANDS.slice(0, 3).map((b) => <label key={b.min} className="chip-choice"><input type="radio" name="min" value={b.min} defaultChecked={min === b.min} /><span>{b.label}{b.min < 85 ? " +" : ""}</span></label>)}
        </div>
        <label className="chip-choice"><input type="checkbox" name="verified" value="1" defaultChecked={verified} /><span>✓ Verified only</span></label>
        <label className="field">Space<select name="space" defaultValue={space}><option value="">Any space</option>{Object.entries(SPACES).filter(([k]) => k !== "OTHER").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Sort<select name="sort" defaultValue={sort}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className="btn primary" type="submit">Apply</button>
        <Link className="btn" href="/flatmates/profile">Edit my profile</Link>
      </form>

      {r.rows.length === 0 ? (
        <section className="card art-empty"><div className="art-empty-ico" aria-hidden="true">🏠</div><h2>No matches with these filters</h2><p className="muted">New people join every day. Try fewer filters, widen your budget, or add more kinds of space you would take.</p></section>
      ) : (
        <ul className="fm-grid">
          {r.rows.map((m, i) => (
            <li key={m.profile.userId} className="card fm-card" style={{ ["--i" as string]: i }}>
              <div className="fm-card-top">
                <MatchBadge score={m.match.score} />
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong className="fm-name">{m.profile.displayName}{m.profile.verified ? <span className="fm-verified" title="Passed the flatmate ID check">✓ Verified</span> : null}</strong>
                  <span className="small muted">{[m.profile.ageBand, m.profile.gender ? m.profile.gender.toLowerCase().replace("_", "-") : "", m.profile.occupation].filter(Boolean).join(" · ")}</span>
                  <span className="small">{INTENTS[m.profile.intent]}</span>
                </div>
              </div>
              {m.profile.spaces.length ? <div className="art-tags">{m.profile.spaces.slice(0, 3).map((x) => <em key={x}>{x}</em>)}{m.profile.furnishing ? <em>{m.profile.furnishing}</em> : null}</div> : null}
              <p className="small muted">{formatKobo(m.profile.budgetMinKobo)}–{formatKobo(m.profile.budgetMaxKobo)} a month · from {formatDate(m.profile.moveInFrom)}{m.profile.areas ? ` · ${m.profile.areas}` : ""}</p>
              {m.match.dealbreaker ? <p className="small fm-bad">{m.match.dealbreaker}</p> : null}
              <ul className="fm-bars" aria-label="How you compare">
                {m.bars.map((b) => <li key={b.label}><span>{b.label}</span><i style={{ ["--v" as string]: `${b.value}%` }} className={b.value >= 85 ? "hi" : b.value >= 50 ? "mid" : "lo"} /></li>)}
              </ul>
              <ul className="fm-reasons">
                {m.match.good.slice(0, 3).map((g) => <li key={g} className="fm-good">{g}</li>)}
                {[...m.match.bad, ...m.match.mixed].slice(0, 2).map((b) => <li key={b} className={m.match.bad.includes(b) ? "fm-bad" : "fm-mixed"}>{b}</li>)}
              </ul>
              <div className="row" style={{ marginTop: "auto" }}>
                <Link className="btn primary" href={`/flatmates/p/${m.profile.userId}`}>{m.request?.status === "ACCEPTED" ? "Matched: open" : m.request?.status === "PENDING" ? (m.request.mine ? "Request sent" : "They asked you: answer") : "View and request"}</Link>
                <form action={hideAction}><input type="hidden" name="userId" value={m.profile.userId} /><button className="btn" type="submit">Hide</button></form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={r.total} pageSize={20} href={(p) => q({ page: String(p) })} noun="matches" />
    </div>
  );
}
