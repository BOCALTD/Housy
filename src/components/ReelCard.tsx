import Link from "next/link";
import type { ReelCard as Card } from "@/lib/services/reels";
import { formatDate } from "@/lib/dates";
import { Field, Pill } from "@/components/ui";
import ShareButton from "@/components/ShareButton";
import { shareText } from "@/lib/share-rules";
import { PLATFORM_NAME } from "@/lib/labels";
import ReelPlayer from "@/components/ReelPlayer";
import { likeAction, reportAction, saveAction } from "@/app/reels/actions";

/** One reel: the clip, who posted it, and the things a person can do with it. */
export function ReelView({ r, back, signedIn, detail = false }: { r: Card; back: string; signedIn: boolean; detail?: boolean }) {
  return (
    <article className="card stack reel-card">
      <ReelPlayer id={r.id} label={r.caption || "Property reel"} music={r.music} />
      <div className="stack" style={{ gap: 4 }}>
        <div className="row between">
          <div><strong>{r.authorName}</strong>{r.companyName ? <span className="small muted"> · {r.companyName}</span> : null}</div>
          {r.status !== "PUBLISHED" ? <Pill status={r.status === "PENDING" || r.status === "DRAFT" ? "PENDING" : "SUSPENDED"} label={r.status === "DRAFT" ? "Draft, only you can see it" : r.status === "PENDING" ? "Being checked" : r.status === "HIDDEN" ? "Hidden" : "Removed"} /> : null}
        </div>
        {r.caption ? <p style={{ overflowWrap: "anywhere" }}>{r.caption}</p> : null}
        {r.music ? <p className="small muted">♪ {r.music.title} · {r.music.artist}{r.music.credit ? ` (licence: ${r.music.licence})` : ""}</p> : null}
        <p className="small muted">{[r.city, r.publishedAt ? formatDate(r.publishedAt) : ""].filter(Boolean).join(" · ")}{r.why.length ? ` · ${r.why[0]}` : ""}</p>
        {r.listingRef ? <p className="small"><Link href={`/properties/${r.listingRef}`}>See the property{r.listingTitle ? `: ${r.listingTitle}` : ""}</Link></p> : null}
      </div>
      {r.status === "PUBLISHED" ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <form action={likeAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><button className="btn small" type="submit" aria-pressed={r.liked}>{r.liked ? "Liked" : "Like"} ({r.likes})</button></form>
          <form action={saveAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><button className="btn small" type="submit" aria-pressed={r.saved}>{r.saved ? "Saved" : "Save"}</button></form>
          <ShareButton kind="reel" small path={`/reels/${r.id}`} reelId={r.id} count={r.shares} signedIn={signedIn} video={`/reels/${r.id}/video`}
            title={r.caption || r.listingTitle || "Property reel"}
            text={shareText("reel", { title: r.caption || r.listingTitle || `A property reel by ${r.authorName}`, place: r.city, by: r.companyName ? `${r.authorName}, ${r.companyName}` : r.authorName }, PLATFORM_NAME)} />
          {detail ? <span className="small muted">{r.comments} comments</span> : <Link className="btn small" href={`/reels/${r.id}`}>Comments ({r.comments})</Link>}
          {!r.mine && signedIn ? (
            <details className="inline"><summary>Report</summary>
              <form action={reportAction} className="stack"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="REEL" /><input type="hidden" name="back" value={back} />
                <Field label="What is wrong?"><input name="reason" required minLength={3} maxLength={300} /></Field><button className="btn small" type="submit">Send report</button></form></details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
