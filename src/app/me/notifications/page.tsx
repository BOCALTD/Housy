import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myNotifications } from "@/lib/services/notifications";
import { formatDateTime } from "@/lib/dates";
import { ShowMore, sp, type SP } from "@/components/ui";
import { ListTools } from "@/components/ListTools";
import { readSort, sortBy } from "@/lib/list-sort";

const SORTS = [
  { key: "date", label: "Date", dir: "desc" as const },
  { key: "unread", label: "Unread first", dir: "desc" as const },
  { key: "title", label: "Title", dir: "asc" as const },
];
import { markReadAction } from "../actions";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams: spP }: { searchParams?: Promise<SP> }) {
  const params = await spP;
  const user = await requireUser();
  const all = await myNotifications(user.id, 300);
  const unread = all.filter((n) => !n.readAt).length;
  const q = (sp(params, "q") ?? "").trim().toLowerCase();
  const show = sp(params, "show") ?? "";
  const sort = readSort(params, SORTS);
  const matched = all.filter((n) => (show !== "unread" || !n.readAt) && (!q || `${n.title} ${n.body}`.toLowerCase().includes(q)));
  const notes = sort.key === "unread" ? sortBy(sortBy(matched, (n) => n.createdAt, "desc"), (n) => (n.readAt ? 0 : 1), sort.dir) : sortBy(matched, sort.key === "title" ? (n) => n.title : (n) => n.createdAt, sort.dir);
  return (
    <div className="stack-lg">
      <div className="row between"><h1>Notifications</h1>
        {unread > 0 ? <form action={markReadAction}><button className="btn" type="submit">Mark all as read</button></form> : null}</div>
      <p className="small muted">Every notice appears here. Which ones also come by email, push or text is set in <Link href="/me/notification-settings">Notification settings</Link>.</p>
      <ListTools path="/me/notifications" params={params} q={sp(params, "q") ?? ""} label="Search notifications" placeholder="Search notices" options={SORTS} sort={sort}>
        <select name="show" defaultValue={show} aria-label="Show"><option value="">All</option><option value="unread">Unread only{unread ? ` (${unread})` : ""}</option></select>
      </ListTools>
      <section className="card">
        {notes.length === 0 ? <p className="muted">{q || show ? "No notices match." : "No notifications."}</p> : (
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
