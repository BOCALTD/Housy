import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myReels } from "@/lib/services/reels";
import { Flash, ShowMore, sp, type SP } from "@/components/ui";
import { ReelView } from "@/components/ReelCard";
import { sendDraftAction, withdrawAction } from "../actions";

export const metadata = { title: "My reels" };
export const dynamic = "force-dynamic";

export default async function MyReelsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const mine = await myReels(user.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>My reels</h1><p className="muted"><Link href="/reels/new">Post a reel</Link> · <Link href="/reels">All reels</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {mine.length === 0 ? <div className="card"><p className="muted">You have not posted a reel yet.</p></div> : (
        <ShowMore noun="more reels" limit={3} items={mine.map((r) => (
          <li key={r.id} style={{ listStyle: "none" }}>
            <div className="stack" style={{ width: "100%" }}>
              <ReelView r={r} back="/reels/mine" signedIn />
              {r.reviewNote && r.status !== "PUBLISHED" ? <p className="small muted">Platform note: {r.reviewNote}</p> : null}
              {r.status === "DRAFT" ? (
                <form action={sendDraftAction} className="stack">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="field">Caption<textarea name="caption" rows={2} maxLength={300} defaultValue={r.caption} /></label>
                  <div className="row"><button className="btn primary small" type="submit">Send for checking</button></div>
                </form>
              ) : null}
              {r.status !== "REMOVED" ? <form action={withdrawAction}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit">{r.status === "DRAFT" ? "Delete this draft" : "Withdraw this reel"}</button></form> : null}
            </div>
          </li>))} />
      )}
    </div>
  );
}
