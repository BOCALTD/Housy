"use client";
import { useEffect } from "react";

/**
 * Keeps the opening loader closed once it has done its job. If React has to redraw the page itself (for example after a
 * mismatch between the server and the browser), it also resets the classes boot.js put on <html>, which would bring the
 * loader back at 0% and leave it there. boot.js records its state on window, which a redraw does not touch.
 */
export function BootGuard() {
  useEffect(() => {
    const w = window as unknown as { __boot?: string };
    const H = document.documentElement;
    if (w.__boot !== "running" && !H.classList.contains("boot-off")) { H.classList.add("boot-off"); H.classList.remove("booting"); }
  }, []);
  return null;
}
