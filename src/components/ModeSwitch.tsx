"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Switch between property listings and reels. A two-way toggle at the top of both screens, and on a touch screen a
 * sideways swipe does the same (swipe left for reels, right for listings). A swipe that starts on a slideshow,
 * carousel, form field, map or anything that scrolls sideways is left alone, so it never fights those.
 */
export function ModeSwitch({ active }: { active: "listings" | "reels" }) {
  const router = useRouter();
  useEffect(() => {
    let x = 0, y = 0, t = 0, ok = false;
    const blocked = (el: EventTarget | null) => {
      let n = el as HTMLElement | null;
      while (n && n !== document.body) {
        if (n.matches?.("input, select, textarea, video, iframe, .carousel, .hero-rot, .slides, .nav-scroll, .map, [data-no-swipe]")) return true;
        if (n.scrollWidth > n.clientWidth + 4 && ["auto", "scroll"].includes(getComputedStyle(n).overflowX)) return true;
        n = n.parentElement;
      }
      return false;
    };
    const down = (e: TouchEvent) => { const p = e.touches[0]; x = p.clientX; y = p.clientY; t = Date.now(); ok = e.touches.length === 1 && !blocked(e.target); };
    const up = (e: TouchEvent) => {
      if (!ok) return;
      ok = false;
      const p = e.changedTouches[0], dx = p.clientX - x, dy = p.clientY - y;
      if (Date.now() - t > 700 || Math.abs(dx) < 90 || Math.abs(dy) > Math.abs(dx) / 2) return;
      if (active === "listings" && dx < 0) router.push("/reels");
      if (active === "reels" && dx > 0) router.push("/");
    };
    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchend", up, { passive: true });
    return () => { document.removeEventListener("touchstart", down); document.removeEventListener("touchend", up); };
  }, [active, router]);

  return (
    <nav className="mode-switch" aria-label="Show properties or reels">
      <Link href="/" aria-current={active === "listings" ? "page" : undefined}>For you</Link>
      <Link href="/reels" aria-current={active === "reels" ? "page" : undefined}>Property reels</Link>
      <span className="mode-hint" aria-hidden="true">{active === "listings" ? "Swipe left for reels" : "Swipe right for properties"}</span>
    </nav>
  );
}
