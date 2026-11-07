import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { commentsFor, getReel } from "@/lib/services/reels";
import { Flash, sp, type SP } from "@/components/ui";
import { ReelView } from "@/components/ReelCard";
import { ReelComments } from "@/components/ReelComments";
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
  const comments = await commentsFor(reel.id, 0, viewerId);
  const here = `/reels/${reel.id}`;
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <h1 className="visually-hidden">Reel by {reel.authorName}</h1>
      <p className="small"><Link href="/reels">Back to reels</Link></p>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <ReelView r={reel} back={here} signedIn={!!viewerId} detail />
      {!viewerId ? <SignupNudge path={`/reels/${reel.id}`} shared={sp(searchParams, "shared") === "1"} what="this reel" perks={["More short videos of homes near you", "Like, save and comment", reel.listingRef ? "Every photo and detail of the property" : "Follow agents and companies"]} /> : null}
      {reel.status === "PUBLISHED" ? <ReelComments reelId={reel.id} initial={comments.rows} total={comments.total} pages={comments.pages} signedIn={!!viewerId} /> : null}
    </div>
  );
}
