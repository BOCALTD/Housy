"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AssistantChat } from "./AssistantChat";

/** "Ask Housy": a button on every page that opens the assistant beside the page (full screen on a phone). */
export function AssistantLauncher({ name, workspace, starters }: { name?: string | null; workspace: boolean; starters: string[] }) {
  const path = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  // Not on pages that are already the assistant, a chat, or reels (which fill the screen).
  if (/^\/(assistant|app\/assistant|messages|reels|auth)(\/|$)/.test(path)) return null;
  return (
    <>
      <button type="button" className={`ai-fab${open ? " on" : ""}`} aria-expanded={open} aria-controls="ai-panel" onClick={() => setOpen((o) => !o)}>
        <span className="ai-fab-orb" aria-hidden="true">✦</span><span>{open ? "Close" : "Ask Housy"}</span>
      </button>
      {open ? (
        <div className="ai-panel" id="ai-panel" role="dialog" aria-label="Housy assistant">
          <div className="ai-panel-head"><strong>✦ Housy assistant</strong><a href="/assistant" className="small">Open full screen</a><button type="button" className="ai-x" aria-label="Close the assistant" onClick={() => setOpen(false)}>×</button></div>
          <AssistantChat workspace={workspace} name={name} starters={starters} compact />
        </div>
      ) : null}
    </>
  );
}
