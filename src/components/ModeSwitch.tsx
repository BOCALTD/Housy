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
    // The new screen slides in from the side the finger pushed towards (reels from the right, properties from the left).
    const go = (to: string, from: "right" | "left") => {
      const H = document.documentElement;
      H.dataset.enter = from;
      router.push(to);
      setTimeout(() => { if (H.dataset.enter === from) delete H.dataset.enter; }, 900);
    };
    const up = (e: TouchEvent) => {
      if (!ok) return;
      ok = false;
      const p = e.changedTouches[0], dx = p.clientX - x, dy = p.clientY - y;
      if (Date.now() - t > 700 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) / 2) return;
      if (active === "listings" && dx < 0) go("/reels", "right");
      if (active === "reels" && dx > 0) go("/", "left");
    };
    // Laptops: a two-finger sideways swipe on the trackpad does the same.
    let acc = 0, last = 0;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 2 || blocked(e.target)) return;
      const now = Date.now(); if (now - last > 400) acc = 0; last = now; acc += e.deltaX;
      if (active === "listings" && acc > 160) { acc = 0; go("/reels", "right"); }
      if (active === "reels" && acc < -160) { acc = 0; go("/", "left"); }
    };
    window.addEventListener("wheel", wheel, { passive: true });
    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchend", up, { passive: true });
    return () => { document.removeEventListener("touchstart", down); document.removeEventListener("touchend", up); window.removeEventListener("wheel", wheel); };
  }, [active, router]);

  return (
    <nav className="mode-switch" aria-label="Show properties or reels">
      <Link href="/" aria-current={active === "listings" ? "page" : undefined}>For you</Link>
      <Link href="/reels" aria-current={active === "reels" ? "page" : undefined}>Property reels</Link>
      <span className="mode-hint" aria-hidden="true">{active === "listings" ? <>Swipe left for reels <i className="mode-arrow">←</i></> : <><i className="mode-arrow back">→</i> Swipe right for properties</>}</span>
    </nav>
  );
}
