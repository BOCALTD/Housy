"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { dayLabel, timeLabel, type ChatMsg, type ChatReaction } from "@/lib/chat-shape";
import { MAX_FILE_BYTES, MAX_VOICE_MS, REACTIONS, fileLabel, formatBytes, formatDuration, isAudio, isImage, tallyReactions } from "@/lib/chat-files";
import { confirmAction } from "./Confirm";
import { LocationBubble, LocationShare } from "./ChatLocation";

type Pending = ChatMsg & { state?: "sending" | "failed" };
type LocIn = { lat: number; lng: number; label?: string; accuracyM?: number | null; source: "device" | "map" };
type Live = { location: (id: string, loc: LocIn) => Promise<{ ok: true; message: ChatMsg } | { ok: false; error: string }>; typing: (id: string) => Promise<void>; react: (messageId: string, emoji: string | null) => Promise<{ ok: true; reactions: ChatReaction[] } | { ok: false; error: string }> };

const naira = (kobo: unknown) => { try { return `₦${(BigInt(String(kobo)) / 100n).toLocaleString("en-NG")}`; } catch { return ""; } };
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,.pptx,text/plain,text/csv";
/** What this browser can record voice notes as, best first (Safari records MP4, others WebM or Ogg). */
const recordType = () => typeof MediaRecorder === "undefined" ? null : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";

function Ticks({ seen }: { seen: boolean }) {
  return (
    <svg className={`ticks${seen ? " seen" : ""}`} viewBox="0 0 18 12" width="18" height="12" aria-label={seen ? "Seen" : "Sent"}>
      <path d="m1 6.5 3 3L10 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {seen ? <path d="m7 9.5 1 0L15 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

const Icon = {
  clip: <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" /></svg>,
  mic: <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>,
  send: <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z" /></svg>,
  smile: <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></svg>,
  doc: <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>,
};

/**
 * A conversation that reads like a phone chat: bubbles (yours on the right), a separator for each day, the time and ticks in
 * each bubble (two ticks once the other person has read it), reactions, files and voice notes, "typing" when the other person is
 * writing, and a composer pinned at the bottom. Messages send without the page reloading, and new ones appear by themselves every
 * few seconds while the chat is open.
 */
export function ChatThread({ conversationId, meId, initial, initialSeen, canReply, send, live, extras, timeZone = "Africa/Lagos" }: {
  conversationId: string; meId: string; initial: ChatMsg[]; initialSeen: string | null; canReply: boolean; timeZone?: string;
  send: (id: string, body: string) => Promise<{ ok: true; message: ChatMsg } | { ok: false; error: string }>;
  live: Live;
  /** Server-rendered extras for special messages (inspection answers, reports), by message id. */
  extras?: Record<string, React.ReactNode>;
}) {
  const [msgs, setMsgs] = useState<Pending[]>(initial);
  const [seen, setSeen] = useState<string | null>(initialSeen);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [rec, setRec] = useState<{ state: "recording" | "review"; started: number; ms: number; blob?: Blob; url?: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const lastTyping = useRef(0);
  const recorder = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; timer: number } | null>(null);

  const last = msgs.filter((m) => !m.state).at(-1)?.at ?? new Date(0).toISOString();
  const first = msgs.find((m) => !m.state)?.at ?? null;
  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const q = new URLSearchParams({ after: last, ...(first ? { from: first } : {}) });
      const r = await fetch(`/api/messages/${conversationId}?${q}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { messages: ChatMsg[]; seenUpTo: string | null; typing?: string[]; reactions?: (ChatReaction & { messageId: string })[] };
      setSeen(j.seenUpTo);
      setTyping(j.typing ?? []);
      setMsgs((all) => {
        const have = new Set(all.map((m) => m.id));
        const merged: Pending[] = [...all, ...j.messages.filter((m) => !have.has(m.id))];
        if (!j.reactions) return merged;
        const by = new Map<string, ChatReaction[]>();
        for (const x of j.reactions) by.set(x.messageId, [...(by.get(x.messageId) ?? []), { emoji: x.emoji, userId: x.userId }]);
        return merged.map((m) => (m.state ? m : { ...m, reactions: by.get(m.id) ?? [] }));
      });
    } catch { /* offline for a moment: the next check catches up */ }
  }, [conversationId, last, first]);

  useEffect(() => { const id = window.setInterval(() => void poll(), 4000); const vis = () => { if (!document.hidden) void poll(); }; document.addEventListener("visibilitychange", vis); return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", vis); }; }, [poll]);
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }, [text]);
  useEffect(() => () => { const r = recorder.current; if (r) { window.clearInterval(r.timer); r.stream.getTracks().forEach((t) => t.stop()); } }, []);
  useEffect(() => () => { if (rec?.url) URL.revokeObjectURL(rec.url); }, [rec?.url]);

  const replace = (tempId: string, m: ChatMsg) => setMsgs((all) => all.map((x) => (x.id === tempId ? m : x)).filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i));
  const fail = (tempId: string, error: string) => { setMsgs((all) => all.map((x) => (x.id === tempId ? { ...x, state: "failed" } : x))); toast.error(error); };

  function onType(v: string) {
    setText(v);
    const now = Date.now();
    if (v.trim() && now - lastTyping.current > 3000) { lastTyping.current = now; void live.typing(conversationId); }
  }

  async function upload(f: Blob, name: string, kind: "FILE" | "VOICE", caption: string, durationMs?: number) {
    const temp: Pending = { id: `tmp-${Date.now()}`, senderId: meId, senderName: "You", kind, body: caption, details: {}, masked: false, at: new Date().toISOString(), state: "sending", file: { id: "", name, mime: f.type, size: f.size, durationMs: durationMs ?? null } };
    stick.current = true;
    setMsgs((all) => [...all, temp]);
    const form = new FormData();
    form.set("file", f, name);
    form.set("kind", kind);
    form.set("caption", caption);
    if (durationMs) form.set("durationMs", String(Math.round(durationMs)));
    try {
      const r = await fetch(`/api/messages/${conversationId}/attachments`, { method: "POST", body: form });
      const j = (await r.json().catch(() => ({}))) as { message?: ChatMsg; error?: string };
      if (r.ok && j.message) replace(temp.id, j.message); else fail(temp.id, j.error || "The file could not be sent. Try again.");
    } catch { fail(temp.id, "The file could not be sent. Check your connection and try again."); }
  }

  async function submit() {
    if (file) {
      const f = file;
      const ok = await confirmAction({ title: "Send this file?", body: `${f.name} (${formatBytes(f.size)}) goes to everyone in this chat.`, ok: "Send file", tone: "default" });
      if (!ok) return;
      const caption = text.trim();
      setFile(null); setText("");
      if (fileInput.current) fileInput.current.value = "";
      await upload(f, f.name, "FILE", caption);
      return;
    }
    const body = text.trim();
    if (!body) return;
    const temp: Pending = { id: `tmp-${Date.now()}`, senderId: meId, senderName: "You", kind: "TEXT", body, details: {}, masked: false, at: new Date().toISOString(), state: "sending" };
    setText(""); stick.current = true; lastTyping.current = 0;
    setMsgs((all) => [...all, temp]);
    const r = await send(conversationId, body);
    if (r.ok) replace(temp.id, r.message); else fail(temp.id, r.error);
    box.current?.focus();
  }

  function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { toast.error("Files can be up to 10 MB."); if (fileInput.current) fileInput.current.value = ""; return; }
    setFile(f);
    box.current?.focus();
  }

  async function startRecording() {
    const type = recordType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) { toast.error("This browser cannot record voice notes. Try a recent Chrome, Safari or Firefox."); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {
      toast.error((e as { name?: string }).name === "NotAllowedError" ? "The microphone is blocked for this site. Allow it in your browser's site settings, then try again." : "The microphone could not start.");
      return;
    }
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const started = Date.now();
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: (mr.mimeType || type || "audio/webm").split(";")[0] });
      setRec({ state: "review", started, ms: Date.now() - started, blob, url: URL.createObjectURL(blob) });
    };
    const timer = window.setInterval(() => {
      const ms = Date.now() - started;
      setRec((r) => (r && r.state === "recording" ? { ...r, ms } : r));
      if (ms >= MAX_VOICE_MS) stopRecording();
    }, 250);
    recorder.current = { mr, stream, chunks, timer };
    mr.start(500);
    setRec({ state: "recording", started, ms: 0 });
    void live.typing(conversationId);
  }

  function stopRecording() {
    const r = recorder.current;
    if (!r) return;
    window.clearInterval(r.timer);
    recorder.current = null;
    if (r.mr.state !== "inactive") r.mr.stop();
  }

  function discardRecording() {
    const r = recorder.current;
    if (r) { window.clearInterval(r.timer); r.mr.onstop = null; if (r.mr.state !== "inactive") r.mr.stop(); r.stream.getTracks().forEach((t) => t.stop()); recorder.current = null; }
    setRec(null);
  }

  async function sendRecording() {
    if (!rec?.blob) return;
    const { blob, ms } = rec;
    setRec(null);
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    await upload(blob, `Voice note.${ext}`, "VOICE", "", ms);
  }

  async function react(m: Pending, emoji: string) {
    setPicker(null);
    const mine = (m.reactions ?? []).find((r) => r.userId === meId);
    const next = mine?.emoji === emoji ? null : emoji;
    const before = m.reactions ?? [];
    const optimistic = [...before.filter((r) => r.userId !== meId), ...(next ? [{ emoji: next, userId: meId }] : [])];
    setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, reactions: optimistic } : x)));
    const r = await live.react(m.id, next);
    if (r.ok) setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, reactions: r.reactions } : x)));
    else { setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, reactions: before } : x))); toast.error(r.error); }
  }

  let lastDay = "";
  return (
    <div className="chat">
      <div className="chat-scroll" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="chat-wall" aria-hidden="true" />
        <p className="chat-lock">🔒 Messages stay between the people in this chat. Never pay before you have inspected the property. Only open files from people you trust.</p>
        <ol className="chat-list" aria-live="polite">
          {msgs.map((m) => {
            const mine = m.senderId === meId;
            const day = dayLabel(m.at, new Date(), timeZone);
            const sep = day !== lastDay ? (lastDay = day) : null;
            const d = m.details as Record<string, string | number | null>;
            const isSeen = !!seen && !m.state && new Date(m.at) <= new Date(seen);
            const f = m.file;
            const url = f?.id ? `/api/messages/attachment/${f.id}` : null;
            const tally = tallyReactions(m.reactions ?? [], meId);
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
                  {m.kind === "LOCATION" && typeof d.lat === "number" && typeof d.lng === "number" ? (
                    <LocationBubble lat={d.lat} lng={d.lng} label={m.body} accuracyM={typeof d.accuracyM === "number" ? d.accuracyM : null} source={String(d.source ?? "map")} />
                  ) : null}
                  {f && m.kind === "VOICE" ? (
                    <div className="bubble-voice">
                      {url ? <audio controls preload="metadata" src={url} aria-label={`Voice note, ${formatDuration(f.durationMs ?? 0)}`} /> : <span className="small">🎙 Sending voice note…</span>}
                      <span className="bubble-file-meta">🎙 {formatDuration(f.durationMs ?? 0)}</span>
                    </div>
                  ) : null}
                  {f && m.kind === "FILE" && isImage(f.mime) && url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a className="bubble-photo" href={url} target="_blank" rel="noopener"><img src={url} alt={f.name} loading="lazy" /></a>
                  ) : null}
                  {f && m.kind === "FILE" && (!isImage(f.mime) || !url) ? (
                    <a className="bubble-file" href={url ? `${url}?download=1` : undefined} aria-disabled={!url} download={f.name}>
                      <span className="bubble-file-icon">{Icon.doc}</span>
                      <span className="bubble-file-text"><strong>{f.name}</strong><span className="bubble-file-meta">{fileLabel(f.mime)} · {formatBytes(f.size)}{url ? " · Download" : " · Sending…"}</span></span>
                    </a>
                  ) : null}
                  {m.body && m.kind !== "LOCATION" ? <p className="bubble-text">{m.body}</p> : null}
                  {m.masked ? <p className="bubble-note">Contact details were hidden: the sender&apos;s plan does not include sharing them.</p> : null}
                  {extras?.[m.id] ?? null}
                  <span className="bubble-meta">
                    <time dateTime={m.at}>{timeLabel(m.at, timeZone)}</time>
                    {mine ? (m.state === "sending" ? <span className="clock" aria-label="Sending">🕓</span> : m.state === "failed" ? <span className="fail">Not sent</span> : <Ticks seen={isSeen} />) : null}
                  </span>
                </div>
                {!m.state ? (
                  <div className="bubble-react">
                    {tally.length ? <span className="reactions" aria-label={tally.map((t) => `${t.emoji} ${t.count}`).join(", ")}>{tally.map((t) => <span key={t.emoji} className={t.mine ? "mine" : undefined}>{t.emoji}{t.count > 1 ? <b>{t.count}</b> : null}</span>)}</span> : null}
                    {canReply ? <button type="button" className="react-btn" aria-label="React" aria-expanded={picker === m.id} onClick={() => setPicker((p) => (p === m.id ? null : m.id))}>{Icon.smile}</button> : null}
                    {picker === m.id ? (
                      <div className="react-pick" role="group" aria-label="Choose a reaction">
                        {REACTIONS.map((e) => <button key={e} type="button" aria-pressed={(m.reactions ?? []).some((r) => r.userId === meId && r.emoji === e)} onClick={() => void react(m, e)}>{e}</button>)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      {typing.length ? <p className="chat-typing" aria-live="polite">{typing.join(", ")} {typing.length === 1 ? "is" : "are"} typing…</p> : null}
      {canReply ? (
        rec ? (
          <div className="composer recorder" role="group" aria-label="Voice note">
            {rec.state === "recording" ? (
              <>
                <span className="rec-dot" aria-hidden="true" /><span className="rec-time" aria-live="off">{formatDuration(rec.ms)}</span>
                <span className="small muted rec-hint">Recording · up to {formatDuration(MAX_VOICE_MS)}</span>
                <button type="button" className="btn" onClick={discardRecording}>Cancel</button>
                <button type="button" className="send" aria-label="Stop recording" onClick={stopRecording}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg></button>
              </>
            ) : (
              <>
                {rec.url ? <audio controls src={rec.url} className="rec-preview" aria-label="Your voice note" /> : null}
                <button type="button" className="btn" onClick={discardRecording}>Delete</button>
                <button type="button" className="send" aria-label="Send voice note" onClick={() => void sendRecording()}>{Icon.send}</button>
              </>
            )}
          </div>
        ) : (
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" className="composer-btn" aria-label="Attach a file" onClick={() => fileInput.current?.click()}>{Icon.clip}</button>
            <LocationShare start={{ lat: 6.5244, lng: 3.3792 }} onSend={async (loc) => {
              const temp: Pending = { id: `tmp-${Date.now()}`, senderId: meId, senderName: "You", kind: "LOCATION", body: loc.label ?? "", details: { lat: loc.lat, lng: loc.lng, accuracyM: loc.accuracyM ?? null, source: loc.source }, masked: false, at: new Date().toISOString(), state: "sending" };
              stick.current = true;
              setMsgs((all) => [...all, temp]);
              const r = await live.location(conversationId, loc);
              if (r.ok) replace(temp.id, r.message); else fail(temp.id, r.error);
            }} />
            <div className="composer-main">
              {file ? (
                <div className="composer-file">
                  <span>{isImage(file.type) ? "🖼" : isAudio(file.type) ? "🎙" : "📄"} {file.name} <span className="muted">· {formatBytes(file.size)}</span></span>
                  <button type="button" className="composer-file-x" aria-label="Remove the file" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}>×</button>
                </div>
              ) : null}
              <textarea ref={box} rows={1} value={text} maxLength={4000} placeholder={file ? "Add a caption (optional)" : "Message"} aria-label={file ? "Caption" : "Write a message"} enterKeyHint="send"
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) { e.preventDefault(); void submit(); } }} />
            </div>
            {!text.trim() && !file ? (
              <button type="button" className="send" aria-label="Record a voice note" onClick={() => void startRecording()}>{Icon.mic}</button>
            ) : (
              <button type="submit" className="send" aria-label={file ? "Send file" : "Send"}>{Icon.send}</button>
            )}
          </form>
        )
      ) : null}
    </div>
  );
}
