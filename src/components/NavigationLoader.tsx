"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader } from "./Logo";

/**
 * Shows the logo loader while a link to another page is loading. It is done in the browser on purpose: a route-level
 * loading.tsx would make the server answer every page with status 200 and redirect afterwards, which would break the
 * real 307 redirects the app (and its tests) rely on for signed-out visitors.
 */
export function NavigationLoader() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  useEffect(() => { clear(); setBusy(false); }, [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      clear();
      // Wait a moment so quick pages do not flash it, and never leave it up for long.
      timers.current.push(window.setTimeout(() => setBusy(true), 200), window.setTimeout(() => setBusy(false), 10000));
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); clear(); };
  }, []);

  return busy ? <div className="loader-overlay"><Loader /></div> : null;
}
