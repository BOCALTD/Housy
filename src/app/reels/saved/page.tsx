import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { mySaved } from "@/lib/services/reels";
import { Flash, sp, type SP } from "@/components/ui";
import { ReelView } from "@/components/ReelCard";

export const metadata = { title: "Saved reels" };
export const dynamic = "force-dynamic";

export default async function SavedReelsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const page = Math.max(0, Number.parseInt(sp(searchParams, "page") ?? "0", 10) || 0);
  const saved = await mySaved(user.id, page);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Saved reels</h1><p className="muted">Only you can see what you have saved. <Link href="/reels">Back to reels</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {saved.rows.length === 0 ? <div className="card"><p className="muted">Nothing saved yet.</p></div> : <div className="stack-lg">{saved.rows.map((r) => <ReelView key={r.id} r={r} back={`/reels/saved?page=${saved.page}`} signedIn />)}</div>}
      {saved.pages > 1 ? (
        <div className="row between">
          {saved.page > 0 ? <Link className="btn" href={`/reels/saved?page=${saved.page - 1}`}>Previous</Link> : <span />}
          {saved.page + 1 < saved.pages ? <Link className="btn" href={`/reels/saved?page=${saved.page + 1}`}>Next</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
