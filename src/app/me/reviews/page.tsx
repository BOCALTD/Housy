import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myReviews, reviewableConversations } from "@/lib/services/reviews";
import { BASIS_LABEL } from "@/lib/reputation-rules";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { appealReviewAction } from "../../reviews/actions";

export const metadata = { title: "My reviews" };
export const dynamic = "force-dynamic";

export default async function MyReviewsPage({ searchParams }: { searchParams?: SP }) {
  const user = await requireUser();
  const [mine, open] = await Promise.all([myReviews(user.id), reviewableConversations(user.id)]);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>My reviews</h1><p className="muted">Reviews you have written, and the people you could review now. <Link href="/me">Back to my account</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>You can review ({open.length})</h2>
        {open.length === 0 ? <p className="muted">When you and an agent have both written in a conversation, and a day has passed, they appear here. A company can also give you a review link after a viewing or a completed deal.</p> : (
          <ShowMore noun="more" limit={4} items={open.map((c) => <li key={c.id}><div className="row between" style={{ width: "100%" }}><div><strong>{c.agentName}</strong> <span className="small muted">{c.subject}</span></div><Link className="btn" href={`/reviews/write?conversation=${c.id}`}>Write a review</Link></div></li>)} />
        )}
      </section>
      <section className="card stack">
        <h2>Written by you ({mine.length})</h2>
        {mine.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ShowMore noun="more reviews" limit={4} items={mine.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
              <div className="row between"><div><strong>{r.overall} out of 5</strong> <span className="small muted">{BASIS_LABEL[r.basis]} · {formatDate(r.createdAt)} · <span className="mono">{r.ref}</span></span></div><Pill status={r.status === "PUBLISHED" ? "ACTIVE" : r.status === "HELD" ? "PENDING" : "SUSPENDED"} label={r.status === "HELD" ? "Being checked" : humanize(r.status)} /></div>
              {r.body ? <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{r.body}</p> : null}
              {r.events.length ? <details className="inline"><summary>History</summary><ul className="timeline">{r.events.map((e) => <li key={e.id}>{formatDate(e.createdAt)}: {humanize(e.kind)}{e.note ? ` — ${e.note}` : ""}</li>)}</ul></details> : null}
              {r.status === "HIDDEN" || r.status === "REMOVED" ? (
                <details className="inline"><summary>Appeal this decision</summary>
                  <form action={appealReviewAction} className="stack"><input type="hidden" name="id" value={r.id} /><Field label="Why should it be restored?"><textarea name="reason" rows={3} required minLength={10} /></Field><button className="btn" type="submit">Send appeal</button></form></details>
              ) : null}
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
