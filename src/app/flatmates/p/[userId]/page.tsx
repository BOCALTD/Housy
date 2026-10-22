import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { flatmateView, myFlatmateProfile } from "@/lib/services/flatmates";
import { INTENTS } from "@/lib/flatmate-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { MatchBadge } from "@/components/MatchBadge";
import { answerAction, hideAction, requestAction, withdrawAction } from "../../actions";

export const metadata = { title: "Flatmate profile" };
export const dynamic = "force-dynamic";

export default async function FlatmateProfileView({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams?: Promise<SP> }) {
  const { userId } = await params;
  const s = await searchParams;
  const user = await requireUser();
  if (!(await myFlatmateProfile(user.id))) return (
    <div className="card stack"><h1>Make your profile first</h1><p className="muted">Flatmate profiles are visible only to people who have one too.</p><p><Link className="btn primary" href="/flatmates/profile">Make my flatmate profile</Link></p></div>
  );
  const v = await flatmateView(user.id, userId);
  if (!v) notFound();
  const { profile: p, match: m, request: r } = v;
  return (
    <div className="stack-lg">
      <div className="fm-profile-head card">
        <MatchBadge score={m.score} size="lg" />
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <p className="eyebrow">Flatmate · {p.city}</p>
          <h1 className="fm-name">{p.displayName}</h1>
          <p className="muted small">{[p.ageBand, p.gender ? p.gender.toLowerCase().replace("_", "-") : "", p.occupation].filter(Boolean).join(" · ")}</p>
          <p className="small">{INTENTS[p.intent]}</p>
        </div>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <div className="two">
        <section className="card stack">
          <h2>Why this score</h2>
          {m.dealbreaker ? <p className="fm-bad">{m.dealbreaker}</p> : null}
          {m.good.length ? <><h3 className="small-h">Where you agree</h3><ul className="fm-reasons">{m.good.map((g) => <li key={g} className="fm-good">{g}</li>)}</ul></> : null}
          {m.bad.length ? <><h3 className="small-h">Worth talking about</h3><ul className="fm-reasons">{m.bad.map((b) => <li key={b} className="fm-bad">{b}</li>)}</ul></> : <p className="small muted">No clear clashes.</p>}
        </section>
        <section className="card stack">
          <h2>Their plans</h2>
          <dl className="kv">
            <div><dt>Budget a month</dt><dd>{formatKobo(p.budgetMinKobo)} to {formatKobo(p.budgetMaxKobo)}</dd></div>
            <div><dt>Move in from</dt><dd>{formatDate(p.moveInFrom)}{p.stayMonths ? ` · for ${p.stayMonths} months` : ""}</dd></div>
            {p.areas ? <div><dt>Areas</dt><dd>{p.areas}</dd></div> : null}
            {p.roomListingRef ? <div><dt>Their room</dt><dd><Link className="tap" href={`/properties/${p.roomListingRef}`}>{p.roomListingRef}</Link></dd></div> : null}
          </dl>
          {p.about ? <p style={{ whiteSpace: "pre-wrap" }}>{p.about}</p> : null}
        </section>
      </div>
      <section className="card stack">
        <h2>How they live</h2>
        <dl className="kv">{p.lifestyle.map((x) => <div key={x.key}><dt>{x.question}</dt><dd>{x.answer}</dd></div>)}</dl>
      </section>
      <section className="card stack" id="request">
        {!r || r.status === "WITHDRAWN" || (r.status === "DECLINED" && !r.mine) ? (
          <form action={requestAction} className="stack">
            <input type="hidden" name="to" value={p.userId} />
            <h2>Ask to match</h2>
            <Field label="A short hello (optional)" hint="No phone numbers or emails: you can share them in the chat room once you match."><textarea name="note" rows={2} maxLength={300} /></Field>
            <div className="row"><button className="btn primary" type="submit">Send request</button></div>
          </form>
        ) : r.status === "PENDING" && r.mine ? (
          <div className="stack"><h2>Request sent</h2><p className="muted small">You will be told when {p.displayName} answers.</p><form action={withdrawAction}><input type="hidden" name="id" value={r.id} /><button className="btn" type="submit">Withdraw request</button></form></div>
        ) : r.status === "PENDING" ? (
          <form action={answerAction} className="stack">
            <input type="hidden" name="id" value={r.id} />
            <h2>{p.displayName} asked to match</h2>
            {r.note ? <p>&ldquo;{r.note}&rdquo;</p> : null}
            <div className="row"><button className="btn primary" name="decision" value="accept" type="submit">Accept and open a chat room</button><button className="btn" name="decision" value="decline" type="submit">Decline</button></div>
          </form>
        ) : r.status === "ACCEPTED" ? (
          <div className="stack"><h2>You are matched</h2><div className="row"><Link className="btn primary" href="/flatmates/requests">Go to your chat rooms</Link></div></div>
        ) : <p className="muted">{r.status === "DECLINED" ? "They did not take up your request." : "This match was ended."}</p>}
        <div className="row">
          <form action={hideAction}><input type="hidden" name="userId" value={p.userId} /><button className="btn" type="submit">Hide from my matches</button></form>
          <Link className="btn" href={`/trust?category=HARASSMENT&targetKind=USER&targetRef=${encodeURIComponent(`flatmate:${p.userId}`)}`}>Report this profile</Link>
        </div>
      </section>
    </div>
  );
}
