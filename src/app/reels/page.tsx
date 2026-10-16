import Link from "next/link";
import { getSession } from "@/lib/auth";
import { discover, type Tab } from "@/lib/services/reels";
import { Flash, sp, type SP } from "@/components/ui";
import { ReelView } from "@/components/ReelCard";

export const metadata = { title: "Reels" };
export const dynamic = "force-dynamic";

const TABS: { id: Tab; label: string }[] = [{ id: "foryou", label: "For you" }, { id: "following", label: "Following" }, { id: "trending", label: "Popular" }];

export default async function ReelsPage({ searchParams }: { searchParams?: SP }) {
  const session = await getSession();
  const viewerId = session?.user.id ?? null;
  const asked = sp(searchParams, "tab");
  const tab = (TABS.find((t) => t.id === asked)?.id ?? (viewerId ? "foryou" : "trending")) as Tab;
  const page = Math.max(0, Number.parseInt(sp(searchParams, "page") ?? "0", 10) || 0);
  const feed = await discover({ viewerId, tab: viewerId ? tab : "trending", page });
  const here = `/reels?tab=${tab}&page=${page}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Reels</h1>
        <p className="muted">Short videos of homes and neighbourhoods from agents. What you see first comes from people you follow and from what others find useful. Paying for a plan or a promotion does not move a reel up.</p>
        <p className="small">{viewerId ? <><Link href="/reels/new">Post a reel</Link> · <Link href="/reels/mine">My reels</Link> · <Link href="/reels/saved">Saved</Link></> : <><Link href="/login">Sign in</Link> to like, save, comment and follow agents.</>}</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {viewerId ? <nav className="nav nav-scroll" aria-label="Reels">{TABS.map((t) => <Link key={t.id} href={`/reels?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined}>{t.label}</Link>)}</nav> : null}
      {feed.rows.length === 0 ? (
        <div className="card"><p className="muted">{tab === "following" ? "Follow agents or companies from the directory and their reels will appear here." : "No reels yet. Agents can post one from this page."}</p></div>
      ) : (
        <div className="stack-lg">{feed.rows.map((r) => <ReelView key={r.id} r={r} back={here} signedIn={!!viewerId} />)}</div>
      )}
      {feed.pages > 1 ? (
        <div className="row between">
          {feed.page > 0 ? <Link className="btn" href={`/reels?tab=${tab}&page=${feed.page - 1}`}>Previous</Link> : <span />}
          <span className="small muted">Page {feed.page + 1} of {feed.pages}</span>
          {feed.page + 1 < feed.pages ? <Link className="btn" href={`/reels?tab=${tab}&page=${feed.page + 1}`}>Next</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
