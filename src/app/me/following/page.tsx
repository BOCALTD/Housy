import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myFollowing } from "@/lib/services/community";
import { humanize } from "@/lib/labels";
import { Flash, ShowMore, sp, type SP } from "@/components/ui";
import { unfollowAction } from "../actions";

export const metadata = { title: "Following" };
export const dynamic = "force-dynamic";

export default async function FollowingPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const follows = await myFollowing(user.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Following</h1><p className="muted">Following chooses what updates you see. It does not give anyone access to your details, and it is not a collaboration.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        {follows.length === 0 ? <p className="muted">You are not following anyone yet. <Link href="/directory">Find agents and companies</Link>.</p> : (
          <ShowMore noun="more" limit={6} items={follows.map((f) => (
            <li key={f.id}><div className="row between" style={{ width: "100%" }}>
              <div><strong>{f.name ?? "No longer listed"}</strong> <span className="small muted">{humanize(f.kind)}{f.sub ? ` · ${f.sub}` : ""}</span>{f.blurb ? <div className="small muted">{f.blurb}</div> : null}</div>
              <form action={unfollowAction}><input type="hidden" name="kind" value={f.kind} /><input type="hidden" name="targetId" value={f.targetId} /><button className="btn" type="submit">Unfollow</button></form>
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
