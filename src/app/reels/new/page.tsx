import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listingChoices } from "@/lib/services/reels";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { uploadAction } from "../actions";

export const metadata = { title: "Post a reel" };
export const dynamic = "force-dynamic";

export default async function NewReelPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const c = await listingChoices(user.id);
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 6 }}><h1>Post a reel</h1><p className="muted">A short video of a property or neighbourhood. The platform team checks every reel before anyone sees it. <Link href="/reels">Back to reels</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {!c.listed ? <div className="card stack"><p>Only listed agents can post reels. Add your agent profile and tick the box to list it.</p><Link className="btn" href="/app/profile">Go to my profile</Link></div> : (
        <form action={uploadAction} className="card stack" encType="multipart/form-data">
          <Field label="Video" hint="MP4 or WebM, up to 4 MB (roughly 10 to 20 seconds). Only film what you own or have permission to show; do not show people's faces or documents without consent."><input type="file" name="video" accept="video/mp4,video/webm" required /></Field>
          <Field label="Caption" hint="Up to 300 characters. Be accurate about the property."><textarea name="caption" rows={3} maxLength={300} /></Field>
          <Field label="Property (optional)" hint="Link the reel to one of your company's published properties.">
            <select name="listingId" defaultValue=""><option value="">No property</option>{c.listings.map((l) => <option key={l.id} value={l.id}>{l.title} ({l.city})</option>)}</select>
          </Field>
          <Field label="Area (optional)" hint="Shown with the reel and used to suggest it to people interested in the area."><input name="city" maxLength={80} /></Field>
          <div className="row">
            <button className="btn primary" type="submit" name="intent" value="post">Send for checking</button>
            <button className="btn" type="submit" name="intent" value="draft">Save as draft</button>
          </div>
          <p className="small muted">A draft is kept in My reels where only you can see it, until you send it.</p>
        </form>
      )}
    </div>
  );
}
