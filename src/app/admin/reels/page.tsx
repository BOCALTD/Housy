import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { reelQueue } from "@/lib/services/reels";
import { formatDate } from "@/lib/dates";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import ReelPlayer from "@/components/ReelPlayer";
import { decideReportsAction, moderateReelAction } from "./actions";

export const metadata = { title: "Reel moderation" };
export const dynamic = "force-dynamic";

export default async function AdminReelsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const q = await reelQueue(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Reel moderation</h1><p className="muted">Every reel is checked before it is public. Several reports hide a reel or comment until you decide. <Link href="/admin">Back to admin</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Waiting to be checked ({q.pending.length})</h2>
        {q.pending.length === 0 ? <p className="muted">Nothing waiting.</p> : (
          <ShowMore noun="more reels" limit={2} items={q.pending.map((r) => (
            <li key={r.id} style={{ listStyle: "none" }}>
              <div className="stack" style={{ width: "100%" }}>
                <ReelPlayer id={r.id} label={r.caption || "Reel to check"} />
                <div><strong>{r.authorName}</strong> <span className="small muted">{formatDate(r.createdAt)}{r.city ? ` · ${r.city}` : ""}</span></div>
                {r.caption ? <p style={{ overflowWrap: "anywhere" }}>{r.caption}</p> : null}
                <form action={moderateReelAction} className="stack"><input type="hidden" name="id" value={r.id} />
                  <Field label="Note to the agent" hint="Needed when you hide or remove."><input name="note" maxLength={300} /></Field>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn primary" name="action" value="publish" type="submit">Publish</button>
                    <button className="btn" name="action" value="hide" type="submit">Send back</button>
                    <button className="btn" name="action" value="remove" type="submit">Remove</button>
                  </div>
                </form>
              </div>
            </li>))} />
        )}
      </section>
      <section className="card stack">
        <h2>Reported ({q.reports.length})</h2>
        {q.reports.length === 0 ? <p className="muted">No open reports.</p> : (
          <ShowMore noun="more reports" limit={3} items={q.reports.map((g) => (
            <li key={`${g.kind}:${g.targetId}`} style={{ listStyle: "none" }}>
              <div className="stack" style={{ width: "100%" }}>
                <div><strong>{g.kind === "REEL" ? "Reel" : "Comment"}</strong> by {g.authorName} <span className="small muted">· {g.count} {g.count === 1 ? "report" : "reports"}{g.reelStatus === "HIDDEN" ? " · hidden" : ""}</span></div>
                {g.caption ? <p style={{ overflowWrap: "anywhere" }}>{g.caption}</p> : null}
                <details className="inline"><summary>Reasons given</summary><ul>{g.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul></details>
                <p className="small"><Link href={`/reels/${g.reelId}`}>Open the reel</Link></p>
                <form action={decideReportsAction} className="stack"><input type="hidden" name="id" value={g.targetId} /><input type="hidden" name="kind" value={g.kind} />
                  <Field label="Reason for your decision"><input name="note" required minLength={3} maxLength={300} /></Field>
                  <div className="row" style={{ gap: 8 }}><button className="btn primary" name="decision" value="uphold" type="submit">Remove it</button><button className="btn" name="decision" value="dismiss" type="submit">Dismiss reports</button></div>
                </form>
              </div>
            </li>))} />
        )}
      </section>
    </div>
  );
}
