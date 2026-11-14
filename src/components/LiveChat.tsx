"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONSENT_COOKIE } from "@/lib/consent";
import { OPEN_COOKIE_CHOICE } from "./CookieNotice";

type Provider = "tawk" | "crisp" | "tidio" | "intercom";
type Visitor = { name: string; email: string } | null;

/** Told by the cookie notice when a choice is made, so the chat can start without a reload. */
export const COOKIE_CHOSEN = "housy:cookie-chosen";

// The providers' own globals, set by their scripts.
type W = Window & {
  Tawk_API?: Record<string, unknown> & { maximize?: () => void; hideWidget?: () => void; showWidget?: () => void };
  Tawk_LoadStart?: Date;
  $crisp?: unknown[][]; CRISP_WEBSITE_ID?: string;
  tidioChatApi?: { open: () => void; hide: () => void; show: () => void; on: (e: string, f: () => void) => void };
  tidioIdentify?: Record<string, string>;
  Intercom?: ((...a: unknown[]) => void) & { q?: unknown[] }; intercomSettings?: Record<string, unknown>;
};

const consented = () => document.cookie.split(";").some((c) => c.trim() === `${CONSENT_COOKIE}=all`);

function addScript(src: string) {
  if (document.querySelector(`script[data-live-chat]`)) return;
  const s = document.createElement("script");
  s.async = true; s.src = src; s.charset = "UTF-8"; s.dataset.liveChat = "1";
  document.head.appendChild(s);
}

/**
 * Load the provider's chat with its own button hidden: Housy's button opens it, so it always sits where the layout expects (above
 * the phone menu bar, never under it). When the chat is closed, the provider's button is hidden again.
 */
function load(provider: Provider, id: string, visitor: Visitor, onReady: () => void) {
  const w = window as W;
  if (provider === "tawk") {
    w.Tawk_API = w.Tawk_API || {};
    w.Tawk_LoadStart = new Date();
    if (visitor) w.Tawk_API.visitor = { name: visitor.name, email: visitor.email };
    w.Tawk_API.onLoad = () => { w.Tawk_API?.hideWidget?.(); onReady(); };
    w.Tawk_API.onChatMinimized = () => w.Tawk_API?.hideWidget?.();
    addScript(`https://embed.tawk.to/${id}`);
  } else if (provider === "crisp") {
    w.$crisp = [];
    w.CRISP_WEBSITE_ID = id;
    w.$crisp.push(["do", "chat:hide"]);
    w.$crisp.push(["on", "chat:closed", () => w.$crisp?.push(["do", "chat:hide"])]);
    w.$crisp.push(["on", "session:loaded", () => onReady()]);
    if (visitor) { w.$crisp.push(["set", "user:email", [visitor.email]]); w.$crisp.push(["set", "user:nickname", [visitor.name]]); }
    addScript("https://client.crisp.chat/l.js");
  } else if (provider === "tidio") {
    if (visitor) w.tidioIdentify = { email: visitor.email, name: visitor.name };
    document.addEventListener("tidioChat-ready", () => {
      w.tidioChatApi?.hide();
      w.tidioChatApi?.on("close", () => w.tidioChatApi?.hide());
      onReady();
    }, { once: true });
    addScript(`https://code.tidio.co/${id}.js`);
  } else {
    w.intercomSettings = { api_base: "https://api-iam.intercom.io", app_id: id, hide_default_launcher: true, ...(visitor ? { name: visitor.name, email: visitor.email } : {}) };
    const ic = ((...a: unknown[]) => { (ic.q = ic.q || []).push(a); }) as NonNullable<W["Intercom"]>;
    w.Intercom = ic;
    w.Intercom("onShow", () => undefined);
    addScript(`https://widget.intercom.io/widget/${id}`);
    onReady();
  }
}

function open(provider: Provider) {
  const w = window as W;
  if (provider === "tawk") { w.Tawk_API?.showWidget?.(); w.Tawk_API?.maximize?.(); }
  else if (provider === "crisp") { w.$crisp?.push(["do", "chat:show"]); w.$crisp?.push(["do", "chat:open"]); }
  else if (provider === "tidio") { w.tidioChatApi?.show(); w.tidioChatApi?.open(); }
  else w.Intercom?.("show");
}

/**
 * The support chat. It talks to an outside provider that sets its own cookies, so it starts only once the visitor has accepted
 * optional cookies; before that, the button explains this and opens the cookie choice.
 */
export function LiveChat({ provider, id, visitor }: { provider: Provider; id: string; visitor: Visitor }) {
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);
  const [asked, setAsked] = useState(false);
  const started = useRef(false);
  const wantOpen = useRef(false);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    load(provider, id, visitor, () => { setReady(true); if (wantOpen.current) { wantOpen.current = false; open(provider); } });
  }, [provider, id, visitor]);

  useEffect(() => {
    const check = () => { if (consented()) { setAllowed(true); start(); } };
    check();
    window.addEventListener(COOKIE_CHOSEN, check);
    return () => window.removeEventListener(COOKIE_CHOSEN, check);
  }, [start]);

  const click = () => {
    if (!allowed) { setAsked(true); return; }
    if (ready) open(provider); else wantOpen.current = true;
  };

  return (
    <div className="chat-dock">
      {asked && !allowed ? (
        <div className="chat-ask" role="dialog" aria-label="Live chat needs cookies">
          <p>Live chat is run by our support partner and needs optional cookies. Accept them to start chatting, or write to us from the Support page.</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn primary" onClick={() => { setAsked(false); window.dispatchEvent(new Event(OPEN_COOKIE_CHOICE)); }}>Choose cookies</button>
            <a className="btn" href="/support">Support page</a>
            <button type="button" className="btn" onClick={() => setAsked(false)}>Not now</button>
          </div>
        </div>
      ) : null}
      <button type="button" className="chat-fab" onClick={click} aria-label="Live chat with Housy support">
        <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" /></svg>
        <span>Chat</span>
      </button>
    </div>
  );
}
