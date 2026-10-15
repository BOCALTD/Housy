import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myNotifications } from "@/lib/services/notifications";
import { formatDateTime } from "@/lib/dates";
import { ShowMore } from "@/components/ui";
import { markReadAction } from "../actions";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const notes = await myNotifications(user.id, 200);
  const unread = notes.filter((n) => !n.readAt).length;
  return (
    <div className="stack-lg">
      <div className="row between"><h1>Notifications</h1>
        {unread > 0 ? <form action={markReadAction}><button className="btn" type="submit">Mark all as read</button></form> : null}</div>
      <p className="small muted">Notices appear here in the app. Nothing is sent by email or to your phone.</p>
      <section className="card">
        {notes.length === 0 ? <p className="muted">No notifications.</p> : (
          <ShowMore noun="more notices" limit={8} items={notes.map((n) => (
            <li key={n.id}><div className="row between" style={{ width: "100%" }}>
              <div>{n.link ? <Link href={n.link}><strong>{n.title}</strong></Link> : <strong>{n.title}</strong>}{n.readAt ? "" : " ●"}<div className="small muted">{n.body} · {formatDateTime(n.createdAt)}</div></div>
              {n.readAt ? null : <form action={markReadAction}><input type="hidden" name="id" value={n.id} /><button className="btn" type="submit">Mark as read</button></form>}
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
