"use client";
import { useEffect, useRef, useState } from "react";

/** A number that counts up once when it scrolls into view. The real number is in the page from the start (for search engines, screen readers and people who prefer less motion). */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (value < 5 || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const el = ref.current; if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => { const k = Math.min(1, (t - start) / 1200); setShown(Math.round(value * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
      setShown(0); raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <b ref={ref} aria-label={value.toLocaleString("en-NG")}><span aria-hidden="true">{shown.toLocaleString("en-NG")}</span></b>;
}
