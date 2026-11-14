"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { dayLabel, timeLabel, type ChatMsg } from "@/lib/chat-shape";

type Pending = ChatMsg & { state?: "sending" | "failed" };

const naira = (kobo: unknown) => { try { return `₦${(BigInt(String(kobo)) / 100n).toLocaleString("en-NG")}`; } catch { return ""; } };

function Ticks({ seen }: { seen: boolean }) {
  return (
    <svg className={`ticks${seen ? " seen" : ""}`} viewBox="0 0 18 12" width="18" height="12" aria-label={seen ? "Seen" : "Sent"}>
      <path d="m1 6.5 3 3L10 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {seen ? <path d="m7 9.5 1 0L15 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

/**
 * A conversation that reads like a phone chat: bubbles (yours on the right), a separator for each day, the time and ticks in
 * each bubble (two ticks once the other person has read it), and a composer pinned at the bottom. Messages send without the page
 * reloading, and new ones appear by themselves every few seconds while the chat is open.
 */
export function ChatThread({ conversationId, meId, initial, initialSeen, canReply, send, extras, timeZone = "Africa/Lagos" }: {
  conversationId: string; meId: string; initial: ChatMsg[]; initialSeen: string | null; canReply: boolean; timeZone?: string;
  send: (id: string, body: string) => Promise<{ ok: true; message: ChatMsg } | { ok: false; error: string }>;
  /** Server-rendered extras for special messages (inspection answers, reports), by message id. */
  extras?: Record<string, React.ReactNode>;
}) {
  const [msgs, setMsgs] = useState<Pending[]>(initial);
  const [seen, setSeen] = useState<string | null>(initialSeen);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  const last = msgs.filter((m) => !m.state).at(-1)?.at ?? new Date(0).toISOString();
  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const r = await fetch(`/api/messages/${conversationId}?after=${encodeURIComponent(last)}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { messages: ChatMsg[]; seenUpTo: string | null };
      setSeen(j.seenUpTo);
      if (j.messages.length) setMsgs((all) => { const have = new Set(all.map((m) => m.id)); return [...all, ...j.messages.filter((m) => !have.has(m.id))]; });
    } catch { /* offline for a moment: the next check catches up */ }
  }, [conversationId, last]);

  useEffect(() => { const id = window.setInterval(() => void poll(), 4000); const vis = () => { if (!document.hidden) void poll(); }; document.addEventListener("visibilitychange", vis); return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", vis); }; }, [poll]);
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }, [text]);

  async function submit() {
    const body = text.trim();
    if (!body) return;
    const temp: Pending = { id: `tmp-${Date.now()}`, senderId: meId, senderName: "You", kind: "TEXT", body, details: {}, masked: false, at: new Date().toISOString(), state: "sending" };
    setText(""); stick.current = true;
    setMsgs((all) => [...all, temp]);
    const r = await send(conversationId, body);
    if (r.ok) setMsgs((all) => all.map((m) => (m.id === temp.id ? r.message : m)).filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i));
    else { setMsgs((all) => all.map((m) => (m.id === temp.id ? { ...m, state: "failed" } : m))); toast.error(r.error); }
    box.current?.focus();
  }

  let lastDay = "";
  return (
    <div className="chat">
      <div className="chat-scroll" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="chat-wall" aria-hidden="true" />
        <p className="chat-lock">🔒 Messages stay between the people in this chat. Never pay before you have inspected the property.</p>
        <ol className="chat-list" aria-live="polite">
          {msgs.map((m) => {
            const mine = m.senderId === meId;
            const day = dayLabel(m.at, new Date(), timeZone);
            const sep = day !== lastDay ? (lastDay = day) : null;
            const d = m.details as Record<string, string | number | null>;
            const isSeen = !!seen && !m.state && new Date(m.at) <= new Date(seen);
            return (
              <li key={m.id} className={mine ? "me" : "them"}>
                {sep ? <div className="chat-day"><span>{sep}</span></div> : null}
                <div className={`bubble${m.state ? ` ${m.state}` : ""}${m.kind !== "TEXT" ? " card-bubble" : ""}`}>
                  {!mine ? <span className="bubble-name">{m.senderName}</span> : null}
                  {m.kind === "PROPERTY" ? (
                    <Link className="bubble-prop" href={`/properties/${String(d.publicRef)}`}>
                      <strong>{String(d.title)}</strong>
                      <span>{[d.city, d.state].filter(Boolean).join(", ")}{d.bedrooms ? ` · ${d.bedrooms} bed` : ""}</span>
                      {d.priceKobo ? <b>{naira(d.priceKobo)}</b> : null}
                      <em>View the property ›</em>
                    </Link>
                  ) : null}
                  {m.kind === "INSPECTION_REQUEST" ? (
                    <div className="bubble-insp"><strong>📅 Inspection request</strong><span>{d.title ? `${d.title} · ` : ""}{String(d.date)} at {String(d.time)}</span></div>
                  ) : null}
                  {m.kind === "INSPECTION_REPLY" ? <div className="bubble-insp"><strong>{String(d.decision) === "accept" ? "✅ Accepted" : "Declined"} the inspection request</strong></div> : null}
                  {m.body ? <p className="bubble-text">{m.body}</p> : null}
                  {m.masked ? <p className="bubble-note">Contact details were hidden: the sender&apos;s plan does not include sharing them.</p> : null}
                  {extras?.[m.id] ?? null}
                  <span className="bubble-meta">
                    <time dateTime={m.at}>{timeLabel(m.at, timeZone)}</time>
                    {mine ? (m.state === "sending" ? <span className="clock" aria-label="Sending">🕓</span> : m.state === "failed" ? <span className="fail">Not sent</span> : <Ticks seen={isSeen} />) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {canReply ? (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <textarea ref={box} rows={1} value={text} maxLength={4000} placeholder="Message" aria-label="Write a message" enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) { e.preventDefault(); void submit(); } }} />
          <button type="submit" className="send" aria-label="Send" disabled={!text.trim()}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z" /></svg>
          </button>
        </form>
      ) : null}
    </div>
  );
}
