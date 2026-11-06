"use client";

import { useEffect, useRef, useState } from "react";

export type Theme = "light" | "dark" | "system";
const OPTIONS: { v: Theme; label: string; hint: string }[] = [
  { v: "light", label: "Light", hint: "Always light" },
  { v: "dark", label: "Dark", hint: "Always dark" },
  { v: "system", label: "Device", hint: "Follow this device" },
];

function Glyph({ t }: { t: Theme }) {
  if (t === "light") return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (t === "dark") return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
}

/** Apply a theme now and remember it (a cookie, so the next page is drawn in it from the start, with no flash). */
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  document.cookie = `theme=${t}; path=/; max-age=31536000; samesite=lax`;
}

/** Light, Dark or Device: a small menu in the top bar. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const [t, setT] = useState<Theme>(initial);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", k); };
  }, [open]);
  const pick = (v: Theme) => { setT(v); applyTheme(v); setOpen(false); };
  return (
    <div className="theme-switch" ref={ref}>
      <button type="button" className="bar-btn theme-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Colour theme: ${OPTIONS.find((o) => o.v === t)!.label}`} title="Light, dark or device" onClick={() => setOpen((o) => !o)}>
        <Glyph t={t} />
      </button>
      {open ? (
        <div className="theme-menu" role="menu" aria-label="Colour theme">
          {OPTIONS.map((o) => (
            <button key={o.v} type="button" role="menuitemradio" aria-checked={t === o.v} className={t === o.v ? "on" : ""} onClick={() => pick(o.v)}>
              <Glyph t={o.v} /><span><strong>{o.label}</strong><small>{o.hint}</small></span>{t === o.v ? <em aria-hidden="true">✓</em> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The same three choices as a row of buttons, for the settings page. */
export function ThemeChoice({ initial }: { initial: Theme }) {
  const [t, setT] = useState<Theme>(initial);
  return (
    <div className="theme-choice" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={t === o.v} className={t === o.v ? "on" : ""} onClick={() => { setT(o.v); applyTheme(o.v); }}>
          <Glyph t={o.v} /><strong>{o.label}</strong><small>{o.hint}</small>
        </button>
      ))}
    </div>
  );
}
