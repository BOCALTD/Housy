"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** A "More" menu: a button that opens a floating panel of links instead of stretching the page. Closes on choosing a link, on Escape and on a click elsewhere. */
export function MoreMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => { ref.current?.removeAttribute("open"); }, [pathname]);
  useEffect(() => {
    const onDown = (e: Event) => { const d = ref.current; if (d?.open && !d.contains(e.target as Node)) d.removeAttribute("open"); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && ref.current?.open) { ref.current.removeAttribute("open"); (ref.current.querySelector("summary") as HTMLElement | null)?.focus(); } };
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);
  return (
    <details ref={ref} className="nav-more">
      <summary>{label}</summary>
      <div className="nav-panel">{children}</div>
    </details>
  );
}
