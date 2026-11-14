"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { CONSENT_COOKIE } from "@/lib/consent";
import { saveCookieChoice } from "@/app/cookies/actions";

/** Opens the cookie choice again (from the cookie notice page). */
export const OPEN_COOKIE_CHOICE = "housy:cookie-choice";

function hasChoice() {
  return document.cookie.split(";").some((c) => c.trim().startsWith(`${CONSENT_COOKIE}=`));
}

/**
 * The cookie choice, shown once to each visitor until they choose. It sits above the phone menu bar, never under it, and its
 * buttons wrap on narrow screens. Nothing optional is set until "Accept all".
 */
export function CookieNotice() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!hasChoice()) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_CHOICE, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_CHOICE, reopen);
  }, []);
  if (!open) return null;
  const choose = (choice: "all" | "essential") => start(async () => {
    const via = new URLSearchParams(window.location.search).get("via");
    await saveCookieChoice(choice, via);
    setOpen(false);
  });
  return (
    <section className="cookie-notice" role="region" aria-label="Cookie choice">
      <p><strong>Cookies on Housy.</strong> We use essential cookies to keep you signed in and remember your settings. With your permission we also count property visits and credit the person who invited you. No advertising or tracking cookies. <Link href="/legal/cookies">Cookie notice</Link></p>
      <div className="cookie-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => choose("essential")}>Essential only</button>
        <button type="button" className="btn primary" disabled={pending} onClick={() => choose("all")}>Accept all</button>
      </div>
    </section>
  );
}

/** A button that reopens the cookie choice. */
export function ChangeCookieChoice() {
  return <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_CHOICE))}>Change your cookie choice</button>;
}
