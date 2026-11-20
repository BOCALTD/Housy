"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A search box that narrows the list or table under it as you type, without reloading: rows (and list items) that do not contain
 * every word are hidden, and "show more" folds open while searching so nothing is missed. The list itself is unchanged for
 * people without scripts. Wrap the list in it: <QuickFilter label="Search work orders">…</QuickFilter>.
 */
export function QuickFilter({ label, placeholder = "Type to narrow the list", children }: { label: string; placeholder?: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [count, setCount] = useState<{ shown: number; all: number } | null>(null);

  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = [...root.querySelectorAll<HTMLElement>("tbody > tr, ul > li, ol > li")].filter((el) => !el.closest("[data-quickfilter-skip]") && !el.parentElement?.closest("li"));
    let shown = 0;
    for (const r of rows) {
      const hit = !words.length || words.every((w) => (r.textContent ?? "").toLowerCase().includes(w));
      r.hidden = !hit;
      if (hit) shown++;
    }
    for (const d of root.querySelectorAll<HTMLDetailsElement>("details")) {
      if (words.length && !d.dataset.qfWasOpen) { d.dataset.qfWasOpen = d.open ? "1" : "0"; d.open = true; }
      if (!words.length && d.dataset.qfWasOpen) { d.open = d.dataset.qfWasOpen === "1"; delete d.dataset.qfWasOpen; }
    }
    setCount(words.length ? { shown, all: rows.length } : null);
  }, [text]);

  return (
    <div className="quick-filter">
      <label className="list-tools-search" style={{ marginBottom: 8 }}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span className="sr-only">{label}</span>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label} maxLength={120} />
      </label>
      {count ? <p className="small muted" role="status" aria-live="polite">{count.shown === 0 ? "Nothing matches." : `${count.shown} of ${count.all} shown`}</p> : null}
      <div ref={box}>{children}</div>
    </div>
  );
}
