import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { INBOX_PAGE, listConversations, searchMessages } from "@/lib/services/messaging";
import { formatDate } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  await requireUser();
  const { actor } = await currentActor();
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const q = sp(searchParams, "q") ?? "";
  const [{ items, more }, found] = await Promise.all([listConversations(actor, page), searchMessages(actor, q)]);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Messages</h1><p className="muted">Private conversations. Phone numbers and email addresses are shared only on plans that include them. To start one, open an agent in the <Link href="/directory?kind=agents">directory</Link>.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form method="get" className="row"><input name="q" defaultValue={q} placeholder="Search your messages" aria-label="Search your messages" /><button className="btn" type="submit">Search</button></form>
      {q ? (
        <section className="card"><h2>Results for “{q}”</h2>
          {found.length === 0 ? <p className="muted">Nothing found.</p> : (
            <ul className="timeline">{found.slice(0, 8).map((m) => <li key={m.id}><Link href={`/messages/${m.conversationId}`}><strong>{m.senderName}</strong></Link> <span className="small muted">{formatDate(m.createdAt)}</span><div className="small">{m.body.slice(0, 140)}</div></li>)}</ul>
          )}
          {found.length > 8 ? <details className="inline"><summary>Show {found.length - 8} more</summary><ul className="timeline">{found.slice(8).map((m) => <li key={m.id}><Link href={`/messages/${m.conversationId}`}><strong>{m.senderName}</strong></Link> <span className="small muted">{formatDate(m.createdAt)}</span><div className="small">{m.body.slice(0, 140)}</div></li>)}</ul></details> : null}
        </section>
      ) : null}
      <section className="card">
        {items.length === 0 ? <p className="muted">No conversations yet.</p> : (
          <ul className="timeline">{items.map((c) => (
            <li key={c.id}><div className="row between" style={{ width: "100%" }}>
              <div><Link href={`/messages/${c.id}`}><strong>{c.others.join(", ") || "Conversation"}</strong></Link>{c.subject ? <span className="small muted"> · {c.subject}</span> : null}
                <div className="small muted">{c.lastFromMe ? "You: " : ""}{c.preview.slice(0, 90)} · {formatDate(c.lastMessageAt)}</div></div>
              {c.unread ? <span className="pill warn">New</span> : null}
            </div></li>))}</ul>
        )}
        <div className="row between">
          {page > 1 ? <Link className="btn" href={`/messages?page=${page - 1}`}>Previous</Link> : <span />}
          {more ? <Link className="btn" href={`/messages?page=${page + 1}`}>Next</Link> : <span />}
        </div>
        <p className="small muted">{INBOX_PAGE} conversations per page.</p>
      </section>
    </div>
  );
}
