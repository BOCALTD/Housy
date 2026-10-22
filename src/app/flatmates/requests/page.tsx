import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myFlatmateActivity, myRooms } from "@/lib/services/flatmates";
import { band } from "@/lib/flatmate-rules";
import { formatDate } from "@/lib/dates";
import { CardMore, Flash, sp, type SP } from "@/components/ui";
import { MatchBadge } from "@/components/MatchBadge";
import { answerAction, endMatchAction, withdrawAction } from "../actions";

export const metadata = { title: "Flatmate requests and rooms" };
export const dynamic = "force-dynamic";

export default async function RequestsPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const [a, rooms] = await Promise.all([myFlatmateActivity(user.id), myRooms(user.id)]);
  return (
    <div className="stack-lg">
      <div className="portal-head">
        <div className="stack" style={{ gap: 4 }}><p className="eyebrow">Flatmates</p><h1>Requests and chat rooms</h1></div>
        <Link className="btn" href="/flatmates/matches">Back to matches</Link>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />

      <section className="stack"><h2>Your chat rooms ({rooms.length})</h2>
        {rooms.length === 0 ? <p className="muted">When someone accepts your request, or you accept theirs, you are both taken into a private chat room.</p> : (
          <CardMore limit={6} noun="more rooms" items={rooms.map((r) => (
            <li key={r.id} className="card stack fm-room">
              <div className="row between"><strong>{r.members.filter((m) => m.userId !== user.id).map((m) => m.name).join(", ") || "Just you"}</strong><span className="small muted">{r.members.length} in the room · since {formatDate(r.createdAt)}</span></div>
              <div className="row"><Link className="btn primary" href={`/messages/${r.conversationId}`}>Open chat room</Link></div>
            </li>
          ))} />
        )}
      </section>

      <section className="stack"><h2>Asking to match with you ({a.incoming.length})</h2>
        {a.incoming.length === 0 ? <p className="muted">No requests waiting.</p> : (
          <CardMore limit={6} noun="more requests" items={a.incoming.map((r) => (
            <li key={r.id} className="card stack">
              <div className="fm-card-top"><MatchBadge score={r.score} /><div className="stack" style={{ gap: 2 }}><Link className="tap" href={`/flatmates/p/${r.other}`}><strong>{r.name}</strong></Link><span className="small muted">{formatDate(r.createdAt)}</span></div></div>
              {r.note ? <p className="small">&ldquo;{r.note}&rdquo;</p> : null}
              <form action={answerAction} className="row"><input type="hidden" name="id" value={r.id} /><button className="btn primary" name="decision" value="accept" type="submit">Accept and open a chat room</button><button className="btn" name="decision" value="decline" type="submit">Decline</button></form>
            </li>
          ))} />
        )}
      </section>

      <section className="stack"><h2>Your matches ({a.matches.length})</h2>
        {a.matches.length === 0 ? <p className="muted">No matches yet.</p> : (
          <CardMore limit={6} noun="more matches" items={a.matches.map((r) => (
            <li key={r.id} className="card stack">
              <div className="row between"><span><strong>{r.name}</strong><span className="small muted"> · {r.score}%, {band(r.score).label} · matched {r.decidedAt ? formatDate(r.decidedAt) : ""}</span></span></div>
              <div className="row">
                {r.conversationId ? <Link className="btn" href={`/messages/${r.conversationId}`}>Chat room</Link> : null}
                <details className="inline"><summary>End this match</summary><form action={endMatchAction} className="stack"><input type="hidden" name="id" value={r.id} /><p className="small muted">You leave the chat rooms you share, and neither of you can add the other to a room again.</p><button className="btn danger" type="submit">End match</button></form></details>
              </div>
            </li>
          ))} />
        )}
      </section>

      {a.outgoing.length ? (
        <details className="card inline"><summary>Requests you sent, waiting for an answer ({a.outgoing.length})</summary>
          <CardMore limit={6} noun="more" items={a.outgoing.map((r) => (
            <li key={r.id} className="row between"><span><Link className="tap" href={`/flatmates/p/${r.other}`}>{r.name}</Link><span className="small muted"> · {r.score}% · {formatDate(r.createdAt)}</span></span><form action={withdrawAction}><input type="hidden" name="id" value={r.id} /><button className="btn" type="submit">Withdraw</button></form></li>
          ))} />
        </details>
      ) : null}
    </div>
  );
}
