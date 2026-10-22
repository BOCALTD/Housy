"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** The site's main links: a row on wide screens, folded behind a Menu button on phones and tablets. */
export function HeaderNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className="top-toggle" aria-expanded={open} aria-controls="top-nav" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">{open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
        <span>{open ? "Close" : "Menu"}</span>
      </button>
      <nav id="top-nav" className={`nav top-nav${open ? " open" : ""}`} aria-label="Main">{children}</nav>
    </>
  );
}
