import Link from "next/link";
import { getSession } from "@/lib/auth";
import { myFlatmateProfile } from "@/lib/services/flatmates";
import { BANDS } from "@/lib/flatmate-rules";
import { formatDate } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";
import { MatchBadge } from "@/components/MatchBadge";
import { statusAction } from "./actions";

export const metadata = { title: "Find a flatmate" };
export const dynamic = "force-dynamic";

const EXAMPLE = [92, 74, 52, 28];

export default async function FlatmatesHome({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const session = await getSession();
  const mine = session ? await myFlatmateProfile(session.user.id) : null;
  return (
    <div className="stack-lg">
      <section className="fm-hero">
        <div className="stack" style={{ gap: 10 }}>
          <p className="eyebrow">Flatmates and roommates</p>
          <h1>Find someone you&apos;ll actually like living with</h1>
          <p className="muted">Answer a few questions about how you live: smoking, sleep hours, tidiness, guests, noise, pets, whether you&apos;re an introvert or an extrovert, and more. We compare you with people looking in the same city and show how well you match, from 0% to 100%, and why.</p>
          <div className="row">
            {!session ? <><Link className="btn primary" href="/join?next=%2Fflatmates%2Fprofile">Create an account to start</Link><Link className="btn" href="/login?next=%2Fflatmates">Sign in</Link></>
              : mine ? <><Link className="btn primary" href="/flatmates/matches">See my matches</Link><Link className="btn" href="/flatmates/profile">Edit my profile</Link></>
              : <Link className="btn primary" href="/flatmates/profile">Make my flatmate profile</Link>}
          </div>
        </div>
        <div className="fm-hero-badges" aria-hidden="true">{EXAMPLE.map((n) => <MatchBadge key={n} score={n} />)}</div>
      </section>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />

      {mine ? (
        <section className="card stack">
          <h2>Your profile</h2>
          <p className="small muted">{mine.status === "ACTIVE" ? "Visible to other people with a flatmate profile in" : mine.status === "PAUSED" ? "Paused: nobody can see it. Last city:" : "Suspended by the platform. City:"} {mine.city} · updated {formatDate(mine.updatedAt)}</p>
          <div className="row">
            {mine.status === "ACTIVE" ? <form action={statusAction}><input type="hidden" name="to" value="PAUSED" /><button className="btn" type="submit">Pause my profile</button></form> : null}
            {mine.status === "PAUSED" ? <form action={statusAction}><input type="hidden" name="to" value="ACTIVE" /><button className="btn primary" type="submit">Show my profile again</button></form> : null}
            <Link className="btn" href="/flatmates/requests">Requests and chat rooms</Link>
          </div>
          <details className="inline"><summary>Delete my flatmate profile</summary>
            <form action={statusAction} className="stack"><input type="hidden" name="to" value="DELETE" /><p className="small muted">Your profile disappears from matches and waiting requests are withdrawn. Chat rooms you are in stay until you leave them.</p><button className="btn danger" type="submit">Delete it</button></form>
          </details>
        </section>
      ) : null}

      <section className="stack">
        <h2>How matching works</h2>
        <div className="fm-steps">
          <div className="card stack"><strong>1. Tell us how you live</strong><p className="small muted">Twelve quick questions, your budget, area and move-in date. Mark up to three things as must-match: a clash on one of those can never show as a good match.</p></div>
          <div className="card stack"><strong>2. See who suits you</strong><p className="small muted">People in your city, ranked by match, with the reasons: &ldquo;same view on smoking&rdquo;, &ldquo;budgets overlap&rdquo;, &ldquo;different sleep hours&rdquo;. Only first names, never contact details.</p></div>
          <div className="card stack"><strong>3. Match and chat</strong><p className="small muted">Send a request. When they accept, you&apos;re both taken into a private chat room. Add others you&apos;ve matched with to look for a place together, up to six.</p></div>
        </div>
      </section>

      <section className="card stack">
        <h2>What the score means</h2>
        <ul className="fm-bands">
          {BANDS.map((b, i) => <li key={b.label}><MatchBadge score={[92, 74, 52, 28][i]} /><span><strong>{b.label}</strong><span className="small muted"> · {b.min === 0 ? "below 40%" : i === 0 ? "85% and above" : `${b.min}% to ${BANDS[i - 1].min - 1}%`}</span></span></li>)}
        </ul>
        <p className="small muted">Who you would share with (women only, men only, your own gender or anyone) and whether one of you has a room are respected first: people who could not share are never shown to each other.</p>
      </section>

      <section className="card stack">
        <h2>Stay safe</h2>
        <ul className="check-list">
          <li>Profiles show first names only. Contact details are shared in the chat room, only when you choose.</li>
          <li>Meet somewhere public first, and tell a friend where you are going.</li>
          <li>Never pay a deposit or rent before you have seen the room and met the landlord or agent. Check the trust level of the company that lists it.</li>
          <li>Block or report anyone in the chat room. Reports go to the Trust and Safety team.</li>
        </ul>
      </section>
    </div>
  );
}
