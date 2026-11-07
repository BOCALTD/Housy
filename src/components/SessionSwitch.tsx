"use client";

import { useEffect, useRef, useState } from "react";
import { leaveSessionAction } from "@/app/auth-actions";

/**
 * Moving from one account to another is never silent. When someone already signed in opens a sign-in page (staff sign-in,
 * another account, a new account), this asks first: stay where they are, or leave. Leaving shows each step on screen:
 * signing out of the current account, then opening the next sign-in.
 */
type Step = "ask" | "out" | "in" | "failed";

export function SessionSwitch({ name, role, goingTo, stayHref, then }: {
  /** Who is signed in now, and as what ("Agent at Lekki Homes"). */
  name: string; role: string;
  /** Where they are going, in a few words: "the staff sign-in", "another account". */
  goingTo: string;
  /** Back to their own account. */
  stayHref: string;
  /** Where to land once signed out; this same page when left out. */
  then?: string;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>("ask");
  useEffect(() => { if (box.current && !box.current.open) box.current.showModal(); }, []);
  const calm = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, calm() ? 0 : ms));

  async function leave() {
    setStep("out");
    try {
      await Promise.all([leaveSessionAction(), wait(900)]);
      setStep("in");
      await wait(700);
      // A full load, so nothing of the old account (menus, names, cached pages) carries over.
      window.location.replace(then ?? window.location.href);
    } catch { setStep("failed"); }
  }

  return (
    <dialog ref={box} className="cfm switch" aria-labelledby="sw-title" aria-describedby="sw-body"
      onCancel={(e) => { e.preventDefault(); if (step === "ask") window.location.assign(stayHref); }}>
      <div className="cfm-inner">
        {step === "ask" ? (
          <>
            <span className="cfm-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5M15 12H3" /></svg>
            </span>
            <h2 id="sw-title">Leave your account?</h2>
            <p id="sw-body">You are signed in as <strong>{name}</strong> ({role}). To go to {goingTo}, you will be signed out of this account first. Nothing in it changes.</p>
            <div className="cfm-actions">
              <a className="btn cfm-cancel" href={stayHref}>Stay signed in</a>
              <button type="button" className="btn primary cfm-ok" onClick={() => void leave()} autoFocus>Sign out and continue</button>
            </div>
          </>
        ) : step === "failed" ? (
          <>
            <h2 id="sw-title">That did not work</h2>
            <p id="sw-body">You are still signed in. Check your connection and try again.</p>
            <div className="cfm-actions">
              <a className="btn cfm-cancel" href={stayHref}>Back to my account</a>
              <button type="button" className="btn primary cfm-ok" onClick={() => void leave()}>Try again</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="sw-title" className="sr-only">Switching accounts</h2>
            <ol className="switch-steps" id="sw-body" aria-live="polite">
              <li className={step === "out" ? "now" : "done"}><span className="switch-dot" aria-hidden="true" />{step === "out" ? `Signing you out of ${name}…` : `Signed out of ${name}`}</li>
              <li className={step === "in" ? "now" : ""}><span className="switch-dot" aria-hidden="true" />Opening {goingTo}…</li>
            </ol>
          </>
        )}
      </div>
    </dialog>
  );
}

/** Sign out, after asking, with the same on-screen steps. */
export function SignOutButton({ name, className = "btn", label = "Sign out" }: { name: string; className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDialogElement>(null);
  async function go() {
    const { confirmAction } = await import("./Confirm");
    if (!(await confirmAction({ title: "Sign out?", body: `You will be signed out of ${name} on this device. Everything stays in your account.`, ok: "Sign out", tone: "default" }))) return;
    setBusy(true);
    box.current?.showModal();
    try {
      await Promise.all([leaveSessionAction(), new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900))]);
      window.location.replace("/");
    } catch { setBusy(false); box.current?.close(); }
  }
  return (
    <>
      <button type="button" className={className} onClick={() => void go()} disabled={busy}>{label}</button>
      <dialog ref={box} className="cfm switch" aria-label="Signing out">
        <div className="cfm-inner">
          <ol className="switch-steps" aria-live="polite"><li className="now"><span className="switch-dot" aria-hidden="true" />Signing you out of {name}…</li></ol>
        </div>
      </dialog>
    </>
  );
}
