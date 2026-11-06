import Link from "next/link";
import { getSession } from "@/lib/auth";
import { withPublic } from "@/lib/db";
import { discover, getReel, hasReelFilter, type ReelFilter, type Tab } from "@/lib/services/reels";
import { getSearchPref, prefLabel } from "@/lib/services/search-prefs";
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
  // Narrow the reels to a place, rent or buy and a budget. Signed in with My search saved, that is the starting point.
  const num = (v?: string) => { const n = Number((v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; };
  const fromUrl: ReelFilter = { city: (sp(searchParams, "city") ?? "").slice(0, 80) || undefined, purpose: sp(searchParams, "purpose") === "SALE" ? "SALE" : sp(searchParams, "purpose") === "RENT" ? "RENT" : undefined, maxNaira: num(sp(searchParams, "max")) };
  const pref = viewerId && !hasReelFilter(fromUrl) && sp(searchParams, "all") !== "1" ? await getSearchPref(viewerId).catch(() => null) : null;
  let filter: ReelFilter | null = hasReelFilter(fromUrl) ? fromUrl : pref ? { city: pref.city || undefined, purpose: pref.purpose || undefined, maxNaira: pref.maxNaira ?? undefined } : null;
  let filterLabel = pref && hasReelFilter(filter) ? `Your search: ${prefLabel(pref)}` : hasReelFilter(filter) ? [filter!.city, filter!.purpose === "SALE" ? "Buy" : filter!.purpose === "RENT" ? "Rent" : "", filter!.maxNaira ? `up to ₦${Math.round(filter!.maxNaira).toLocaleString("en-NG")}` : ""].filter(Boolean).join(" · ") : "";
  const [first, start, canPost] = await Promise.all([
    discover({ viewerId, tab: viewerId ? tab : "trending", page: 0, filter }),
    sp(searchParams, "r") ? getReel(sp(searchParams, "r")!, viewerId).catch(() => null) : Promise.resolve(null),
    viewerId ? withPublic((tx) => tx.agentProfile.count({ where: { userId: viewerId, listed: true } })).then((n) => n > 0).catch(() => false) : Promise.resolve(false),
  ]);
  // Nothing fits the saved search yet: show every reel rather than an empty screen, and say so.
  const fellBack = !!pref && !hasReelFilter(fromUrl) && first.rows.length === 0;
  const feed = fellBack ? await discover({ viewerId, tab: viewerId ? tab : "trending", page: 0, filter: null }) : first;
  if (fellBack) { filter = null; filterLabel = ""; }
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
      <details className="rf-filter" open={false}>
        <summary aria-label="Filter reels by place, rent or buy and budget">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          <span>{filterLabel || "Filter"}</span>
        </summary>
        <form method="get" action="/reels" className="rf-filter-form">
          {tab !== "foryou" ? <input type="hidden" name="tab" value={tab} /> : null}
          <label className="field">Where<input name="city" defaultValue={filter?.city ?? ""} placeholder="City or area, e.g. Lekki" /></label>
          <fieldset className="rf-filter-purpose"><legend>Rent or buy</legend>
            {[["", "Any"], ["RENT", "Rent"], ["SALE", "Buy"]].map(([v, l]) => <label key={v} className="chip-choice"><input type="radio" name="purpose" value={v} defaultChecked={(filter?.purpose ?? "") === v} /><span>{l}</span></label>)}
          </fieldset>
          <label className="field">Budget (₦, a year for rent)<input name="max" inputMode="numeric" defaultValue={filter?.maxNaira ? String(Math.round(filter.maxNaira)) : ""} placeholder="e.g. 3000000" /></label>
          <div className="row">
            <button className="btn primary" type="submit">Show reels</button>
            {hasReelFilter(filter) ? <Link className="btn" href={`/reels?all=1${tab !== "foryou" ? `&tab=${tab}` : ""}`}>Show all reels</Link> : null}
          </div>
          {viewerId ? <p className="small muted">{pref && !fellBack ? "Starting from your saved search. " : ""}<Link href="/me/settings#my-search">{pref ? "Change my search" : "Save this as my search"}</Link></p> : null}
        </form>
      </details>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {fellBack ? <p className="rf-note" role="status">No reels fit your saved search yet, so these are all reels. <Link href="/me/settings#my-search">Change my search</Link></p> : null}
      {rows.length === 0 && hasReelFilter(filter) ? (
        <div className="rf-nofit" role="status"><p><strong>No reels fit this filter yet.</strong></p><p className="small">Try a nearby area or a higher budget.</p><Link className="btn primary" href={`/reels?all=1${tab !== "foryou" ? `&tab=${tab}` : ""}`}>Show all reels</Link></div>
      ) : null}
      <ReelFeed key={`${tab}-${filterLabel}`} initial={rows} pages={feed.pages} tab={tab} signedIn={!!viewerId} canPost={canPost} filter={filter} />
    </div>
  );
}
