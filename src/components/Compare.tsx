"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const KEY = "compare-refs";
const MAX = 4;
const read = (): string[] => { try { const v = JSON.parse(window.localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX) : []; } catch { return []; } };
const write = (refs: string[]) => { try { window.localStorage.setItem(KEY, JSON.stringify(refs)); } catch { /* private mode: the list lasts for this page only */ } window.dispatchEvent(new Event("compare-change")); };

function useRefs() {
  const [refs, setRefs] = useState<string[]>([]);
  useEffect(() => { const on = () => setRefs(read()); on(); window.addEventListener("compare-change", on); window.addEventListener("storage", on); return () => { window.removeEventListener("compare-change", on); window.removeEventListener("storage", on); }; }, []);
  return refs;
}

/** Add or remove a property from the comparison (up to four). The list is kept in this browser only. */
export function CompareToggle({ refId, compact = false }: { refId: string; compact?: boolean }) {
  const refs = useRefs();
  const on = refs.includes(refId);
  const full = !on && refs.length >= MAX;
  return (
    <button type="button" className={`btn${compact ? " small compare-toggle" : ""}`} aria-pressed={on} disabled={full} title={full ? "You can compare up to four properties" : undefined}
      onClick={() => write(on ? read().filter((r) => r !== refId) : [...read().filter((r) => r !== refId), refId].slice(0, MAX))}>
      {on ? "✓ In comparison" : full ? "Comparison full" : "+ Compare"}
    </button>
  );
}

/**
 * A small bar that appears only once something is picked for comparison, never before. With one picked it asks for
 * another; with two or more it opens the comparison, and opening it clears the picks, so the bar goes away afterwards.
 * It never shows on the comparison page itself.
 */
export function CompareBar() {
  const refs = useRefs();
  const path = usePathname();
  if (refs.length === 0 || path === "/compare") return null;
  return (
    <div className="compare-bar" role="region" aria-label="Comparison">
      {refs.length < 2
        ? <p className="compare-hint">1 property picked. Pick another to compare.</p>
        : <Link className="btn primary" href={`/compare?refs=${refs.join(",")}`} onClick={() => write([])}>Compare {refs.length} properties</Link>}
      <button type="button" className="btn" onClick={() => write([])}>Clear</button>
    </div>
  );
}

/** On the comparison page: take one property out. */
export function RemoveFromCompare({ refId, all }: { refId: string; all: string[] }) {
  return <Link className="btn small" href={`/compare?refs=${all.filter((r) => r !== refId).join(",")}`} onClick={() => write(read().filter((r) => r !== refId))}>Remove</Link>;
}
