import Link from "next/link";
import { getSession } from "@/lib/auth";
import { withPublic } from "@/lib/db";
import { discover, getReel, type Tab } from "@/lib/services/reels";
import { Flash, sp, type SP } from "@/components/ui";
import { ModeSwitch } from "@/components/ModeSwitch";
import { ReelFeed } from "@/components/ReelFeed";

export const metadata = { title: "Property reels", description: "Short videos of homes, land and neighbourhoods from verified agents. Swipe up for the next one." };
export const dynamic = "force-dynamic";

const TABS: { id: Tab; label: string }[] = [{ id: "foryou", label: "For you" }, { id: "following", label: "Following" }, { id: "trending", label: "Popular" }];

export default async function ReelsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const session = await getSession();
  const viewerId = session?.user.id ?? null;
  const asked = sp(searchParams, "tab");
  const tab = (TABS.find((t) => t.id === asked)?.id ?? (viewerId ? "foryou" : "trending")) as Tab;
  const [feed, start, canPost] = await Promise.all([
    discover({ viewerId, tab: viewerId ? tab : "trending", page: 0 }),
    sp(searchParams, "r") ? getReel(sp(searchParams, "r")!, viewerId).catch(() => null) : Promise.resolve(null),
    viewerId ? withPublic((tx) => tx.agentProfile.count({ where: { userId: viewerId, listed: true } })).then((n) => n > 0).catch(() => false) : Promise.resolve(false),
  ]);
  // A shared or returned-to reel opens first.
  const rows = start && start.status === "PUBLISHED" ? [start, ...feed.rows.filter((r) => r.id !== start.id)] : feed.rows;
  return (
    <div className="rf-page">
      <h1 className="visually-hidden">Property reels</h1>
      <div className="rf-head">
        <ModeSwitch active="reels" />
        {viewerId ? (
          <nav className="rf-tabs" aria-label="Which reels">
            {TABS.map((t) => <Link key={t.id} className="rf-tab" href={`/reels?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined} replace>{t.label}</Link>)}
            <Link className="rf-tab" href="/reels/saved">Saved</Link>
            <Link className="rf-tab" href="/reels/mine">Mine</Link>
          </nav>
        ) : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <ReelFeed key={tab} initial={rows} pages={feed.pages} tab={tab} signedIn={!!viewerId} canPost={canPost} />
    </div>
  );
}
