// Files, voice notes and reactions in chats: what is accepted, kept free of the database so it can be tested on its own.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const MAX_VOICE_MS = 3 * 60_000;
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const TYPING_SECONDS = 6;

/** Documents and pictures people send about properties. Nothing that a browser would run (no web pages, SVG or scripts). */
const FILES: Record<string, { label: string; ext: string[] }> = {
  "image/jpeg": { label: "Photo", ext: ["jpg", "jpeg"] },
  "image/png": { label: "Picture", ext: ["png"] },
  "image/webp": { label: "Picture", ext: ["webp"] },
  "application/pdf": { label: "PDF", ext: ["pdf"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word document", ext: ["docx"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { label: "Spreadsheet", ext: ["xlsx"] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { label: "Slides", ext: ["pptx"] },
  "text/plain": { label: "Text file", ext: ["txt"] },
  "text/csv": { label: "CSV file", ext: ["csv"] },
};
/** What phones and browsers record voice notes as. */
const VOICE = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/x-m4a"];

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** The file's real type from its first bytes, or null when it is not what it claims to be. */
export function sniff(bytes: Uint8Array, claimed: string): string | null {
  const c = claimed.split(";")[0].trim().toLowerCase();
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) return c.startsWith("application/vnd.openxmlformats-officedocument.") && FILES[c] ? c : null;
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  if (starts(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (starts(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return c === "audio/x-m4a" || c === "audio/aac" ? c : "audio/mp4";
  if (starts(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (c === "text/plain" || c === "text/csv") {
    // Plain text only: no markup a browser could treat as a page.
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 2048)).toLowerCase();
    if (bytes.slice(0, 2048).includes(0) || /<\s*(html|script|svg|iframe|body)/.test(head)) return null;
    return c;
  }
  return null;
}

/** Why this file cannot be sent, or null. */
export function fileProblem(o: { kind: "FILE" | "VOICE"; size: number; type: string | null; durationMs?: number | null }): string | null {
  if (o.size <= 0) return "Choose a file to send";
  if (o.kind === "VOICE") {
    if (!o.type || !VOICE.includes(o.type)) return "That voice note could not be read. Record it again.";
    if (o.size > MAX_VOICE_BYTES) return "Voice notes can be up to 5 MB. Record a shorter one.";
    if (!o.durationMs || o.durationMs < 500) return "That voice note is too short. Hold the button a little longer.";
    if (o.durationMs > MAX_VOICE_MS + 2000) return "Voice notes can be up to 3 minutes.";
    return null;
  }
  if (!o.type || !FILES[o.type]) return "Send photos (JPEG, PNG, WebP), PDFs, Word, Excel or PowerPoint files, or plain text.";
  if (o.size > MAX_FILE_BYTES) return "Files can be up to 10 MB.";
  return null;
}

export const isImage = (mime: string) => mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
export const isAudio = (mime: string) => mime.startsWith("audio/");
export const fileLabel = (mime: string) => FILES[mime]?.label ?? (isAudio(mime) ? "Voice note" : "File");

/** A safe file name to show and to save as: no folders, no control characters, a sensible length, the right extension. */
export function cleanFileName(name: string, mime: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f"<>|:*?]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
  const ext = FILES[mime]?.ext ?? (isAudio(mime) ? [mime === "audio/webm" ? "webm" : mime === "audio/ogg" ? "ogg" : mime === "audio/mpeg" ? "mp3" : "m4a"] : []);
  if (!ext.length) return base;
  const has = base.toLowerCase().split(".").pop();
  return ext.includes(has ?? "") ? base : `${base}.${ext[0]}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Reactions on one message, for display: each emoji once, with how many, and whether one of them is yours. */
export function tallyReactions(rows: { emoji: string; userId: string }[], meId: string): { emoji: string; count: number; mine: boolean }[] {
  const by = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of rows) {
    const t = by.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    t.count++;
    if (r.userId === meId) t.mine = true;
    by.set(r.emoji, t);
  }
  return [...by.values()].sort((a, b) => REACTIONS.indexOf(a.emoji as Reaction) - REACTIONS.indexOf(b.emoji as Reaction));
}
