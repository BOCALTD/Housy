"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { timeLabel, dayLabel } from "@/lib/chat-shape";

type Row = { id: string; title: string; subject: string | null; preview: string; at: string; unread: boolean; avatar: string | null };
const initials = (s: string) => s.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "•";

type Order = "new" | "old" | "name" | "unread";

/**
 * The chat list: photo or initials, name, last message, when, and a dot for unread. The open chat is highlighted.
 * Typing in the search box narrows the list at once (names, subjects, last messages); pressing Enter searches inside every
 * message. Chats can be shown newest or oldest first, by name, or unread first, and filtered to unread only.
 */
export function ChatList({ rows, timeZone = "Africa/Lagos" }: { rows: Row[]; timeZone?: string }) {
  const path = usePathname();
  const [text, setText] = useState("");
  const [order, setOrder] = useState<Order>("new");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const shown = useMemo(() => {
    const t = text.trim().toLowerCase();
    const list = rows.filter((r) => (!onlyUnread || r.unread) && (!t || `${r.title} ${r.subject ?? ""} ${r.preview}`.toLowerCase().includes(t)));
    const at = (r: Row) => new Date(r.at).getTime();
    return list.sort((a, b) => order === "old" ? at(a) - at(b) : order === "name" ? a.title.localeCompare(b.title, "en", { sensitivity: "base" }) : order === "unread" ? Number(b.unread) - Number(a.unread) || at(b) - at(a) : at(b) - at(a));
  }, [rows, text, order, onlyUnread]);
  const unreadCount = rows.filter((r) => r.unread).length;
  const tools = (
    <div className="chat-tools">
      <form method="get" action="/messages" className="chat-search" role="search">
        <input name="q" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search chats and messages" aria-label="Search chats; press Enter to search inside every message" enterKeyHint="search" maxLength={120} />
      </form>
      <div className="chat-filters" role="group" aria-label="Show and sort chats">
        <button type="button" className={`chip${onlyUnread ? " on" : ""}`} aria-pressed={onlyUnread} onClick={() => setOnlyUnread((v) => !v)}>Unread{unreadCount ? ` (${unreadCount})` : ""}</button>
        <label className="chat-sort">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16" /><path d="m3 8 4-4 4 4" /><path d="M17 20V4" /><path d="m13 16 4 4 4-4" /></svg>
          <span className="sr-only">Sort chats</span>
          <select value={order} onChange={(e) => setOrder(e.target.value as Order)} aria-label="Sort chats">
            <option value="new">Newest first</option>
            <option value="old">Oldest first</option>
            <option value="unread">Unread first</option>
            <option value="name">Name A to Z</option>
          </select>
        </label>
      </div>
    </div>
  );
  if (!rows.length) return <>{tools}<p className="chat-none">No chats yet. Message an agent from their profile, or match with a flatmate, and the chat shows here.</p></>;
  return (
    <>
    {tools}
    {shown.length === 0 ? <p className="chat-none">No chat matches. Press Enter to search inside every message.</p> : null}
    <ul className="chat-rows">
      {shown.map((r) => {
        const day = dayLabel(r.at, new Date(), timeZone);
        return (
          <li key={r.id}>
            <Link href={`/messages/${r.id}`} className={`chat-row${path === `/messages/${r.id}` ? " on" : ""}${r.unread ? " unread" : ""}`} aria-current={path === `/messages/${r.id}` ? "page" : undefined}>
              <span className="avatar">{r.avatar ? <img src={r.avatar} alt="" /> : initials(r.title)}</span>
              <span className="chat-row-text">
                <span className="chat-row-top"><strong>{r.title}</strong><time dateTime={r.at}>{day === "Today" ? timeLabel(r.at, timeZone) : day}</time></span>
                <span className="chat-row-bottom"><span>{r.subject ? `${r.subject} · ` : ""}{r.preview}</span>{r.unread ? <em aria-label="Unread" /> : null}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
    </>
  );
}
