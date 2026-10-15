"use client";

import { useState } from "react";

// "Save or share" for a document. Download always works. On phones and tablets, "Send to another app" opens the
// system share sheet, which offers Files, iCloud Drive, Google Drive, Dropbox, OneDrive and similar apps the person has.
// "Save to Google Drive" appears when the company's deployment has a Google client ID (NEXT_PUBLIC_GOOGLE_CLIENT_ID).

declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (c: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void }) => { requestAccessToken: () => void } } } };
  }
}

const GSI = "https://accounts.google.com/gsi/client";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

function loadGoogle(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google could not be reached"));
    document.head.appendChild(s);
  });
}

function nameFrom(res: Response, fallback: string) {
  const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  return m ? m[1] : fallback;
}

async function fetchFile(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("The document could not be fetched. Sign in again and retry.");
  const blob = await res.blob();
  return { blob, name: nameFrom(res, fallbackName) };
}

function accessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: "https://www.googleapis.com/auth/drive.file",
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error || "Google did not allow access"))),
    });
    client.requestAccessToken();
  });
}

export default function SaveDocument({ url, fallbackName = "document", label = "Save or share" }: { url: string; fallbackName?: string; label?: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [canShare, setCanShare] = useState(false);

  async function run(job: () => Promise<string>) {
    setBusy(true); setMsg("");
    try { setMsg(await job()); } catch (e) { setMsg(e instanceof Error ? e.message : "That did not work"); } finally { setBusy(false); }
  }

  const share = () => run(async () => {
    const { blob, name } = await fetchFile(url, fallbackName);
    const file = new File([blob], name, { type: blob.type });
    if (!navigator.canShare?.({ files: [file] })) throw new Error("This device cannot send files to other apps. Use Download.");
    try { await navigator.share({ files: [file], title: name }); return "Sent."; } catch (e) { if (e instanceof Error && e.name === "AbortError") return ""; throw e; }
  });

  const drive = () => run(async () => {
    await loadGoogle();
    const token = await accessToken();
    const { blob, name } = await fetchFile(url, fallbackName);
    const boundary = `b${Date.now()}`;
    const meta = JSON.stringify({ name });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    if (!res.ok) throw new Error("Google Drive did not accept the file");
    const f = (await res.json()) as { name: string };
    return `Saved to your Google Drive as ${f.name}.`;
  });

  return (
    <details className="inline" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function"); }}>
      <summary>{label}</summary>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <a className="btn" href={url} download>Download</a>
        {canShare ? <button className="btn" type="button" onClick={share} disabled={busy}>Send to another app</button> : null}
        {CLIENT_ID ? <button className="btn" type="button" onClick={drive} disabled={busy}>Save to Google Drive</button> : null}
      </div>
      {canShare ? <p className="small muted">Another app means Files, iCloud Drive, Google Drive, Dropbox, OneDrive or any app on this device that accepts files.</p> : null}
      <p className="small muted" role="status">{busy ? "Working…" : msg}</p>
    </details>
  );
}
