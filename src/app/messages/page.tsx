import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { searchMessages } from "@/lib/services/messaging";
import { formatDate } from "@/lib/dates";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "Chats" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  await requireUser();
  const { actor } = await currentActor();
  const q = sp(searchParams, "q") ?? "";
  if (q) {
    const found = await searchMessages(actor, q);
    return (
      <div className="chat-results">
        <h2>Messages with “{q}”</h2>
        {found.length === 0 ? <p className="muted">Nothing found.</p> : (
          <ul className="chat-rows">{found.slice(0, 40).map((m) => (
            <li key={m.id}><Link className="chat-row" href={`/messages/${m.conversationId}`}><span className="chat-row-text"><span className="chat-row-top"><strong>{m.senderName}</strong><time>{formatDate(m.createdAt)}</time></span><span className="chat-row-bottom"><span>{m.body.slice(0, 160)}</span></span></span></Link></li>
          ))}</ul>
        )}
      </div>
    );
  }
  return (
    <div className="chat-empty">
      <div className="chat-empty-art" aria-hidden="true">💬</div>
      <h2>Your chats</h2>
      <p className="muted">Pick a chat on the left. Agents, companies and flatmates you talk to are all here. Phone numbers and emails are shared only on plans that include them.</p>
      <Link className="btn primary" href="/directory?kind=agents">Find an agent to message</Link>
    </div>
  );
}
