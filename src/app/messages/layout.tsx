import Link from "next/link";
import { getSession } from "@/lib/auth";
import { currentTimeZone } from "@/lib/dates";
import { currentActor } from "@/lib/collab-session";
import { listConversations } from "@/lib/services/messaging";
import { avatarsFor } from "@/lib/services/avatars";
import { ChatList } from "@/components/ChatList";

/** Chats like a phone messenger: the list on the left, the open chat on the right (one at a time on a phone). */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) return <>{children}</>;
  const { actor } = await currentActor();
  const { items } = await listConversations(actor, 1).catch(() => ({ items: [] as Awaited<ReturnType<typeof listConversations>>["items"] }));
  const avatars = await avatarsFor(items.flatMap((c) => c.otherIds)).catch(() => new Map<string, string>());
  const rows = items.map((c) => ({ id: c.id, title: c.others.join(", ") || "Conversation", subject: c.subject, preview: `${c.lastFromMe ? "You: " : ""}${c.preview}`, at: c.lastMessageAt.toISOString(), unread: c.unread, avatar: avatars.get(c.otherIds[0] ?? "") ?? null }));
  return (
    <div className="chat-shell">
      <aside className="chat-side" aria-label="Your chats">
        <div className="chat-side-head">
          <h1 className="chat-side-h">Chats</h1><p className="chat-side-alt" aria-hidden="true">Chats</p>
          <Link href="/directory?kind=agents" className="chat-new" aria-label="Start a new chat with an agent">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </Link>
        </div>
        <form method="get" action="/messages" className="chat-search" role="search">
          <input name="q" type="search" placeholder="Search messages" aria-label="Search messages" />
        </form>
        <ChatList rows={rows} timeZone={currentTimeZone()} />
      </aside>
      <section className="chat-main">{children}</section>
    </div>
  );
}
