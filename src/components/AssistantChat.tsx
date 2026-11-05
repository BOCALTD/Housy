"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ChatAnswer } from "@/lib/services/assistant-chat";

type Msg = { role: "user" | "assistant"; content: string; cards?: ChatAnswer["cards"]; table?: ChatAnswer["table"]; links?: ChatAnswer["links"]; notice?: string; error?: boolean };

/** **bold**, `- ` lists, `1.` lists and [text](/path) links: enough formatting for an answer, and nothing that could run code. */
function Rich({ text }: { text: string }) {
  const inline = (s: string, k: string) => s.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(\/[^)\s]*\))/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong>;
    const m = /^\[([^\]]+)\]\((\/[^)\s]*)\)$/.exec(part);
    if (m) return <Link key={`${k}-${i}`} href={m[2]}>{m[1]}</Link>;
    return <Fragment key={`${k}-${i}`}>{part}</Fragment>;
  });
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (k: number) => { if (list) { const L = list.ordered ? "ol" : "ul"; blocks.push(<L key={`l${k}`}>{list.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</L>); list = null; } };
  text.split("\n").forEach((line, i) => {
    const b = /^\s*[-*•]\s+(.*)$/.exec(line), n = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (b || n) { const ordered = !!n; if (!list || list.ordered !== ordered) { flush(i); list = { ordered, items: [] }; } list.items.push((b ?? n)![1]); return; }
    flush(i);
    if (line.trim()) blocks.push(<p key={`p${i}`}>{inline(line, String(i))}</p>);
  });
  flush(9999);
  return <>{blocks}</>;
}

/**
 * The Housy assistant as a conversation (like Claude): a welcome with suggestions, then a thread that remembers what was said,
 * answers that write themselves out, and the homes or report it found shown as cards or a table. Kept for this browser session.
 */
export function AssistantChat({ workspace = false, name, starters, compact = false }: { workspace?: boolean; name?: string | null; starters: string[]; compact?: boolean }) {
  const key = `housy-assistant-${workspace ? "ws" : "pub"}`;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typed, setTyped] = useState<number>(-1);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { try { const s = sessionStorage.getItem(key); if (s) setMsgs(JSON.parse(s) as Msg[]); } catch { /* fine */ } }, [key]);
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(msgs.slice(-30))); } catch { /* fine */ } }, [key, msgs]);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, typed, busy]);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }, [text]);

  // The newest answer writes itself out (people who prefer less motion see it at once).
  const last = msgs.at(-1);
  useEffect(() => {
    if (!last || last.role !== "assistant" || last.error) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setTyped(-1); return; }
    let i = 0; setTyped(0);
    const step = Math.max(2, Math.round(last.content.length / 120));
    const id = window.setInterval(() => { i += step; if (i >= last.content.length) { window.clearInterval(id); setTyped(-1); } else setTyped(i); }, 16);
    return () => window.clearInterval(id);
  }, [last]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace, messages: next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })) }) });
      const j = (await r.json()) as ChatAnswer & { error?: string };
      if (!r.ok || j.error) throw new Error(j.error || "The assistant is not available just now");
      setMsgs((m) => [...m, { role: "assistant", content: j.text, cards: j.cards, table: j.table, links: j.links, notice: j.source === "RULES" ? j.notice : "" }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: (e as Error).message || "Something went wrong. Try again.", error: true }]);
    } finally { setBusy(false); box.current?.focus(); }
  }

  const first = name ? name.split(/\s+/)[0] : "";
  return (
    <div className={`ai${compact ? " ai-compact" : ""}`}>
      <div className="ai-scroll" ref={scroller}>
        {msgs.length === 0 ? (
          <div className="ai-welcome">
            <div className="ai-orb" aria-hidden="true"><span /></div>
            <h2>{first ? `Hi ${first}, how can I help?` : "How can I help you today?"}</h2>
            <p className="muted">{workspace ? "Ask about your rent, leases, maintenance and properties, or find homes for a client." : "Ask me to find a home, or anything about renting, buying, inspections and staying safe on Housy."}</p>
            <div className="ai-starters">{starters.map((s) => <button key={s} type="button" onClick={() => void ask(s)}>{s}</button>)}</div>
          </div>
        ) : (
          <ol className="ai-thread" aria-live="polite">
            {msgs.map((m, i) => {
              const isLast = i === msgs.length - 1;
              const shown = isLast && typed >= 0 && m.role === "assistant" ? m.content.slice(0, typed) : m.content;
              const done = !(isLast && typed >= 0);
              return (
                <li key={i} className={`ai-msg ${m.role}${m.error ? " err" : ""}`}>
                  {m.role === "assistant" ? <span className="ai-avatar" aria-hidden="true">✦</span> : null}
                  <div className="ai-body">
                    {m.role === "assistant" ? <Rich text={shown} /> : <p>{m.content}</p>}
                    {!done ? <span className="ai-caret" aria-hidden="true" /> : null}
                    {done && m.cards?.length ? (
                      <div className="ai-cards">{m.cards.map((c) => (
                        <Link key={c.ref} href={`/properties/${c.ref}`} className="ai-card">
                          <strong>{c.title}</strong><span>{c.place}{c.beds ? ` · ${c.beds}` : ""}</span><b>{c.price}</b>
                          {c.why.length ? <em>{c.why.join(" · ")}</em> : null}
                        </Link>
                      ))}</div>
                    ) : null}
                    {done && m.table && m.table.rows.length ? (
                      <div className="table-wrap ai-table"><table><thead><tr>{m.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{m.table.rows.slice(0, 10).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table>{m.table.rows.length > 10 ? <p className="small muted">and {m.table.rows.length - 10} more</p> : null}</div>
                    ) : null}
                    {done && m.links?.length ? <div className="ai-links">{m.links.map(([href, label]) => <Link key={href} href={href}>{label} →</Link>)}</div> : null}
                    {done && m.notice ? <p className="ai-notice">{m.notice}</p> : null}
                  </div>
                </li>
              );
            })}
            {busy ? <li className="ai-msg assistant"><span className="ai-avatar" aria-hidden="true">✦</span><div className="ai-body"><span className="ai-thinking" aria-label="Thinking"><i /><i /><i /></span></div></li> : null}
          </ol>
        )}
      </div>
      <form className="ai-composer" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        {msgs.length ? <button type="button" className="ai-new" onClick={() => { setMsgs([]); try { sessionStorage.removeItem(key); } catch { /* fine */ } }} aria-label="Start a new conversation" title="New conversation">＋</button> : null}
        <textarea ref={box} rows={1} value={text} maxLength={600} placeholder={workspace ? "Ask about your portfolio, or find a home…" : "Ask Housy anything…"} aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(text); } }} />
        <button type="submit" className="send" aria-label="Send" disabled={!text.trim() || busy}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M12 3.5 19 11h-4.5v9.5h-5V11H5z" /></svg>
        </button>
      </form>
      <p className="ai-foot">The assistant can make mistakes. Check important details, and never pay before you inspect.</p>
    </div>
  );
}
