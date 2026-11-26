"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type Mode = "listings" | "reels";
const PEEK_ID = "mode-peek";

/**
 * Switch between property listings and reels. A two-way toggle at the top of both screens, and on a touch screen a sideways
 * swipe that follows the finger: as you drag, this screen slides and fades out while the other one fades in from the side,
 * however slowly you move. Let go past about a third of the way (or flick) and it carries on; otherwise it springs back.
 * A swipe that starts on a slideshow, carousel, form field, map or anything that scrolls sideways is left alone, and the
 * browser's own sideways nudge of the page is held back while the swipe is in charge. Less motion asked for: a plain fade.
 */
export function ModeSwitch({ active, peek }: { active: Mode; /** A reel's picture to show while swiping towards reels. */ peek?: string | null }) {
  const router = useRouter();

  useEffect(() => {
    const target = active === "listings" ? "/reels" : "/";
    const dir = active === "listings" ? -1 : 1; // the finger moves left for reels, right for properties
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const main = () => document.getElementById("main");

    // Arriving after a swipe: the other screen's preview is still on top; fade it away now this screen is here.
    const left = document.getElementById(PEEK_ID);
    if (left) {
      requestAnimationFrame(() => {
        left.style.transition = "opacity .28s ease";
        left.style.opacity = "0";
        setTimeout(() => left.remove(), 320);
      });
      const m = main();
      if (m) { m.style.transition = ""; m.style.transform = ""; m.style.opacity = ""; }
    }

    const blocked = (el: EventTarget | null) => {
      let n = el as HTMLElement | null;
      while (n && n !== document.body) {
        if (n.matches?.("input, select, textarea, video, iframe, button, .carousel, .hero-rot, .slides, .nav-scroll, .map, [class*=pbanner], [data-no-swipe], dialog, [role=dialog]")) return true;
        if (n.scrollWidth > n.clientWidth + 4 && ["auto", "scroll"].includes(getComputedStyle(n).overflowX)) return true;
        n = n.parentElement;
      }
      return document.documentElement.classList.contains("intro-on") || document.body.classList.contains("menu-open");
    };

    /** The other screen, drawn while dragging: a reel's picture for reels, a light page for properties. */
    const makePeek = () => {
      document.getElementById(PEEK_ID)?.remove();
      const el = document.createElement("div");
      el.id = PEEK_ID;
      el.className = `mode-peek ${active === "listings" ? "to-reels" : "to-listings"}`;
      el.setAttribute("aria-hidden", "true");
      if (active === "listings" && peek) { const img = document.createElement("img"); img.src = peek; img.alt = ""; img.decoding = "async"; el.appendChild(img); }
      const label = document.createElement("div");
      label.className = "mode-peek-label";
      label.innerHTML = active === "listings"
        ? '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg><span>Property reels</span>'
        : "<span>For you</span><i></i><i></i><i></i>";
      el.appendChild(label);
      el.style.opacity = "0";
      document.body.appendChild(el);
      return el;
    };

    let sx = 0, sy = 0, lastX = 0, lastT = 0, vx = 0;
    let state: "idle" | "deciding" | "dragging" | "off" = "idle";
    let peekEl: HTMLDivElement | null = null;
    let width = window.innerWidth;

    const paint = (dx: number) => {
      const p = Math.max(0, Math.min(1, (dx * dir) / (width * 0.9)));
      const m = main();
      if (m) {
        m.style.transform = still ? "" : `translate3d(${dx * 0.45}px,0,0)`;
        m.style.opacity = String(1 - p * 0.85);
      }
      if (peekEl) {
        peekEl.style.opacity = String(Math.min(1, p * 1.25));
        peekEl.style.transform = still ? "" : `translate3d(${(1 - p) * 30 * -dir}%,0,0)`;
      }
      return p;
    };
    const ease = (on: boolean) => {
      const t = on ? "transform .26s cubic-bezier(.2,.8,.2,1), opacity .26s ease" : "";
      const m = main(); if (m) m.style.transition = t;
      if (peekEl) peekEl.style.transition = t;
    };
    const reset = () => {
      ease(true);
      paint(0);
      const el = peekEl; peekEl = null;
      setTimeout(() => {
        el?.remove();
        const m = main(); if (m) { m.style.transition = ""; m.style.transform = ""; m.style.opacity = ""; }
      }, 280);
    };
    const finish = () => {
      ease(true);
      paint(width * 0.9 * dir);
      router.push(target);
      // If the other screen does not arrive (no connection), put this one back after a while.
      const el = peekEl; peekEl = null;
      setTimeout(() => {
        if (el && document.body.contains(el) && location.pathname !== target) {
          el.remove();
          const m = main(); if (m) { m.style.transition = ""; m.style.transform = ""; m.style.opacity = ""; }
        }
      }, 10000);
    };

    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked(e.target)) { state = "off"; return; }
      const t = e.touches[0];
      sx = lastX = t.clientX; sy = t.clientY; lastT = e.timeStamp; vx = 0; width = window.innerWidth;
      state = "deciding";
    };
    const move = (e: TouchEvent) => {
      if (state === "off" || state === "idle") return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (state === "deciding") {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // Up and down is scrolling; only a mostly sideways move towards the other screen is a swipe.
        if (Math.abs(dx) < Math.abs(dy) * 1.2 || Math.sign(dx) !== dir) { state = "off"; return; }
        state = "dragging";
        router.prefetch(target);
        peekEl = makePeek();
        ease(false);
      }
      if (e.cancelable) e.preventDefault(); // the page itself must not slide or bounce sideways
      const dt = Math.max(1, e.timeStamp - lastT);
      vx = 0.7 * vx + 0.3 * ((t.clientX - lastX) / dt);
      lastX = t.clientX; lastT = e.timeStamp;
      requestAnimationFrame(() => { if (state === "dragging") paint(dx * dir > 0 ? dx : 0); });
    };
    const up = (e: TouchEvent) => {
      if (state !== "dragging") { state = "idle"; return; }
      state = "idle";
      const dx = (e.changedTouches[0]?.clientX ?? lastX) - sx;
      const p = Math.max(0, (dx * dir) / (width * 0.9));
      const flick = vx * dir > 0.45 && dx * dir > 40;
      if (p > 0.33 || flick) finish(); else reset();
    };
    const cancel = () => { if (state === "dragging") reset(); state = "idle"; };

    // Laptops: a two-finger sideways swipe on the trackpad does the same, with a plain slide.
    let acc = 0, lastWheel = 0;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 2 || blocked(e.target)) return;
      const now = Date.now(); if (now - lastWheel > 400) acc = 0; lastWheel = now; acc += e.deltaX;
      if (acc * -dir > 160) {
        acc = 0;
        const H = document.documentElement;
        H.dataset.enter = active === "listings" ? "right" : "left";
        router.push(target);
        setTimeout(() => { delete H.dataset.enter; }, 900);
      }
    };

    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    window.addEventListener("wheel", wheel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", down);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      document.removeEventListener("touchcancel", cancel);
      window.removeEventListener("wheel", wheel);
    };
  }, [active, peek, router]);

  return (
    <nav className="mode-switch" aria-label="Show properties or reels">
      <Link href="/" aria-current={active === "listings" ? "page" : undefined}>For you</Link>
      <Link href="/reels" aria-current={active === "reels" ? "page" : undefined}>Property reels</Link>
      <span className="mode-hint" aria-hidden="true">{active === "listings" ? <>Swipe left for reels <i className="mode-arrow">←</i></> : <><i className="mode-arrow back">→</i> Swipe right for properties</>}</span>
    </nav>
  );
}
