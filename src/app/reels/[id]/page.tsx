import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { commentsFor, getReel } from "@/lib/services/reels";
import { formatDate } from "@/lib/dates";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { ReelView } from "@/components/ReelCard";
import { commentAction, reportAction } from "../actions";
import { SignupNudge } from "@/components/SignupNudge";
import { PLATFORM_NAME } from "@/lib/labels";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const id = (await paramsP).id;
  const r = /^[0-9a-f-]{36}$/.test(id) ? await getReel(id, null).catch(() => null) : null;
  if (!r || r.status !== "PUBLISHED") return { title: "Reel" };
  const title = r.caption ? r.caption.slice(0, 70) : `Property reel by ${r.authorName}`;
  const description = [r.listingTitle, r.city, `Watch it on ${PLATFORM_NAME}.`].filter(Boolean).join(" · ");
  return {
    title, description, alternates: { canonical: `/reels/${r.id}` },
    openGraph: { type: "video.other", siteName: PLATFORM_NAME, title, description, url: `/reels/${r.id}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ReelPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const session = await getSession();
  const viewerId = session?.user.id ?? null;
  const reel = await getReel(params.id, viewerId);
  if (!reel) notFound();
  const page = Math.max(0, Number.parseInt(sp(searchParams, "page") ?? "0", 10) || 0);
  const comments = await commentsFor(reel.id, page);
  const here = `/reels/${reel.id}?page=${page}`;
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <h1 className="visually-hidden">Reel by {reel.authorName}</h1>
      <p className="small"><Link href="/reels">Back to reels</Link></p>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <ReelView r={reel} back={here} signedIn={!!viewerId} detail />
      {!viewerId ? <SignupNudge path={`/reels/${reel.id}`} shared={sp(searchParams, "shared") === "1"} what="this reel" perks={["More short videos of homes near you", "Like, save and comment", reel.listingRef ? "Every photo and detail of the property" : "Follow agents and companies"]} /> : null}
      {reel.status === "PUBLISHED" ? (
        <section className="card stack">
          <h2>Comments ({comments.total})</h2>
          {viewerId ? (
            <form action={commentAction} className="stack"><input type="hidden" name="id" value={reel.id} /><input type="hidden" name="back" value={here} />
              <Field label="Add a comment" hint="Be kind and stay on topic. Links are not allowed."><textarea name="body" rows={2} required maxLength={500} /></Field><button className="btn" type="submit">Post comment</button></form>
          ) : <p className="muted"><Link href="/login">Sign in</Link> to comment.</p>}
          {comments.rows.length === 0 ? <p className="muted">No comments yet.</p> : (
            <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
              {comments.rows.map((c) => (
                <li key={c.id} className="stack" style={{ gap: 4 }}>
                  <div><strong>{c.authorName}</strong> <span className="small muted">{formatDate(c.createdAt)}</span></div>
                  <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{c.body}</p>
                  {viewerId && c.userId !== viewerId ? (
                    <details className="inline"><summary>Report</summary>
                      <form action={reportAction} className="stack"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="kind" value="COMMENT" /><input type="hidden" name="back" value={here} />
                        <Field label="What is wrong?"><input name="reason" required minLength={3} maxLength={300} /></Field><button className="btn small" type="submit">Send report</button></form></details>
                  ) : null}
                </li>))}
            </ul>
          )}
          {comments.pages > 1 ? (
            <div className="row between">
              {comments.page > 0 ? <Link className="btn" href={`/reels/${reel.id}?page=${comments.page - 1}`}>Previous</Link> : <span />}
              {comments.page + 1 < comments.pages ? <Link className="btn" href={`/reels/${reel.id}?page=${comments.page + 1}`}>Next</Link> : <span />}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
