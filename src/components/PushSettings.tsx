"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDeviceAction, removeDeviceAction, testPushAction } from "@/app/push-actions";

function keyBytes(base64url: string) {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function deviceLabel(ua: string) {
  const os = /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

type State = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on" | "no-worker";

/** Turn push notifications on or off for this device, and send a test. Never asks for permission until the person presses the button. */
export function PushSettings({ publicKey }: { publicKey: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  useEffect(() => {
    void (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState(ios && !standalone ? "ios-install" : "unsupported"); return; }
      if (Notification.permission === "denied") { setState("blocked"); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { setState("no-worker"); return; }
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })();
  }, []);

  if (!publicKey) return <p className="small muted">Push notifications are not set up on this server yet. In-app notices and email still work.</p>;

  const turnOn = async () => {
    setBusy(true); setMsg({});
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const r = await addDeviceAction({ endpoint: j.endpoint ?? "", p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "", label: deviceLabel(navigator.userAgent) });
      if (r.error) { await sub.unsubscribe().catch(() => {}); setMsg(r); return; }
      setState("on"); setMsg(r); router.refresh();
    } catch {
      setMsg({ error: "This browser could not turn on notifications. Check that the site is allowed to show notifications, then try again." });
    } finally { setBusy(false); }
  };

  const turnOff = async () => {
    setBusy(true); setMsg({});
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await removeDeviceAction(sub.endpoint); await sub.unsubscribe().catch(() => {}); }
      setState("off"); setMsg({ ok: "Notifications are off for this device." }); router.refresh();
    } finally { setBusy(false); }
  };

  const test = async () => { setBusy(true); setMsg(await testPushAction()); setBusy(false); };

  return (
    <div className="stack">
      {state === "checking" ? <p className="small muted">Checking this device…</p> : null}
      {state === "unsupported" ? <p className="small muted">This browser cannot receive push notifications. Try Chrome, Edge, Firefox or Safari, or install the app.</p> : null}
      {state === "ios-install" ? <p className="small">On iPhone and iPad, notifications work once the app is on your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, open it from there and come back to this page.</p> : null}
      {state === "blocked" ? <p className="small">Notifications are blocked for this site in your browser settings. Allow them there, then reload this page.</p> : null}
      {state === "no-worker" ? <p className="small muted">The app is still setting itself up on this device. Reload the page in a moment.</p> : null}
      {state === "off" ? <div className="row"><button className="btn primary" type="button" disabled={busy} onClick={() => void turnOn()}>Turn on notifications on this device</button></div> : null}
      {state === "on" ? (
        <div className="row">
          <span className="pill ok">On for this device</span>
          <button className="btn" type="button" disabled={busy} onClick={() => void test()}>Send a test</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void turnOff()}>Turn off on this device</button>
        </div>
      ) : null}
      {msg.ok ? <p className="flash notice" role="status">{msg.ok}</p> : null}
      {msg.error ? <p className="flash error" role="alert">{msg.error}</p> : null}
    </div>
  );
}
