import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myFollowing } from "@/lib/services/community";
import { myNotifications } from "@/lib/services/notifications";
import { mySubscription } from "@/lib/services/subscriptions";
import { myCompanies } from "@/lib/services/companies";
import { Flash, ShowMore, sp, type SP } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "My account" };
export const dynamic = "force-dynamic";

export default async function MePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const [follows, notes, plan, companies] = await Promise.all([myFollowing(user.id), myNotifications(user.id, 30), mySubscription(user.id), myCompanies(user.id)]);
  const unread = notes.filter((n) => !n.readAt);
  return (
    <div className="stack-lg">
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <h1>My account</h1>
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{follows.length}</b><span>Following</span></div>
        <div className="stat"><b>{unread.length}</b><span>Unread notices</span></div>
        <div className="stat"><b>{plan.sub ? plan.sub.plan.name : "Free"}</b><span>Your plan</span></div>
      </section>
      {companies.length > 0 ? <p className="small muted">You also belong to a company workspace. <Link href="/app">Open the workspace</Link></p> : null}
      <section className="card">
        <h2>Latest notices</h2>
        {notes.length === 0 ? <p className="muted">Nothing yet. <Link href="/directory">Find agents and companies</Link> to follow.</p> : (
          <ShowMore noun="more notices" limit={4} items={notes.map((n) => (
            <li key={n.id}><div>{n.link ? <Link href={n.link}><strong>{n.title}</strong></Link> : <strong>{n.title}</strong>}{n.readAt ? "" : " ●"}<div className="small muted">{n.body} {formatDateTime(n.createdAt)}</div></div></li>
          ))} />
        )}
        <p className="small"><Link href="/me/notifications">All notifications</Link> · <Link href="/me/reviews">My reviews</Link> · <Link href="/me/verification">Agent verification</Link></p>
      </section>
    </div>
  );
}
