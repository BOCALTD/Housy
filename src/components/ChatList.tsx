"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { timeLabel, dayLabel } from "@/lib/chat-shape";

type Row = { id: string; title: string; subject: string | null; preview: string; at: string; unread: boolean; avatar: string | null };
const initials = (s: string) => s.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "•";

/** The chat list: photo or initials, name, last message, when, and a dot for unread. The open chat is highlighted. */
export function ChatList({ rows, timeZone = "Africa/Lagos" }: { rows: Row[]; timeZone?: string }) {
  const path = usePathname();
  if (!rows.length) return <p className="chat-none">No chats yet. Message an agent from their profile, or match with a flatmate, and the chat shows here.</p>;
  return (
    <ul className="chat-rows">
      {rows.map((r) => {
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
  );
}
