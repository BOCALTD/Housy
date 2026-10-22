"use client";
import { useEffect, useState } from "react";

/**
 * The home page hero: property photographs that cross-fade behind the headline and search. Still for people who prefer less motion,
 * and paused while the pointer or keyboard focus is inside it.
 */
export function HomeHero({ photos, children }: { photos: { src: string; alt: string }[]; children: React.ReactNode }) {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const [calm, setCalm] = useState(true);
  useEffect(() => { setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => {
    if (calm || hold || photos.length < 2) return;
    const id = window.setTimeout(() => setI((n) => (n + 1) % photos.length), 7000);
    return () => window.clearTimeout(id);
  }, [calm, hold, i, photos.length]);
  return (
    <section className="hx" aria-label="Find property" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocusCapture={() => setHold(true)} onBlurCapture={() => setHold(false)}>
      <div className="hx-bg" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photos.map((p, n) => <img key={p.src} src={p.src} alt="" className={n === i ? "on" : undefined} fetchPriority={n === 0 ? "high" : "low"} loading={n === 0 ? "eager" : "lazy"} decoding="async" />)}
      </div>
      <div className="hx-inner">{children}</div>
    </section>
  );
}
