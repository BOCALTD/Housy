"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const SLIDES = [
  { kicker: "Buy · Rent · Lease", title: <>Find your next home from <em className="hl">verified companies.</em></>, text: "Every listing comes from a registered company and is reviewed before it is published. Check a company's trust level before you call." },
  { kicker: "Homes · Land · Commercial", title: <>Homes, land, shops and warehouses, <em className="hl">city by city.</em></>, text: "Search by city, price and bedrooms, browse the street map, watch property reels, or describe what you want in a sentence." },
  { kicker: "For companies and agents", title: <>Selling or letting? <em className="hl">Reach serious buyers.</em></>, text: "Register your company, get verified, run offers, and manage tenants, rent, deals and documents in one workspace." },
];

const Arrow = ({ left }: { left?: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={left ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
);

/**
 * The home page hero: a slideshow of property photographs, each with its own headline, behind the search. It moves on by itself
 * every few seconds, with arrows, dots, swipe and a pause button; it holds still while the keyboard is on its controls.
 * People who prefer less motion get the same slides without the fade.
 */
export function HomeHero({ photos, children }: { photos: { src: string; alt: string }[]; children: React.ReactNode }) {
  const count = Math.min(photos.length, SLIDES.length);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hold, setHold] = useState(false);
  const touch = useRef<number | null>(null);
  const go = useCallback((n: number) => setI(((n % count) + count) % count), [count]);

  useEffect(() => {
    if (paused || hold || count < 2) return;
    const id = window.setTimeout(() => go(i + 1), 6500);
    return () => window.clearTimeout(id);
  }, [paused, hold, i, count, go]);

  const s = SLIDES[i];
  return (
    <section
      className={`hx${paused || hold ? " hx-held" : ""}`} aria-roledescription="carousel" aria-label="Find property"
      onTouchStart={(e) => { if (!(e.target as HTMLElement).closest("form, a, button")) touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="hx-bg" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photos.slice(0, count).map((p, n) => <img key={p.src} src={p.src} alt="" className={n === i ? "on" : undefined} fetchPriority={n === 0 ? "high" : "low"} loading={n === 0 ? "eager" : "lazy"} decoding="async" />)}
      </div>
      <div className="hx-inner">
        <h1 className="visually-hidden">Find property from verified companies and agents</h1>
        <div className="hx-slide" key={i} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} aria-live={paused || hold ? "polite" : "off"}>
          <p className="eyebrow">{s.kicker}</p>
          <p className="hero-title">{s.title}</p>
          <p className="hero-text">{s.text}</p>
        </div>
        {/* Only keyboard focus on the controls holds the slide still; the pause button stops it for good. Hovering does not, so a
            resting mouse pointer never freezes the slideshow. */}
        <div className="hx-controls" onFocus={(e) => setHold(e.target.matches(":focus-visible"))} onBlur={() => setHold(false)}>
          <button type="button" className="hx-arrow" aria-label="Previous slide" onClick={() => go(i - 1)}><Arrow left /></button>
          <div className="hx-dots" role="group" aria-label="Choose a slide">
            {Array.from({ length: count }, (_, n) => (
              <button key={n} type="button" aria-label={`Slide ${n + 1} of ${count}`} aria-current={n === i ? "true" : undefined} onClick={() => go(n)}>
                <span className="hx-dot" />
              </button>
            ))}
          </div>
          <button type="button" className="hx-arrow" aria-label="Next slide" onClick={() => go(i + 1)}><Arrow /></button>
          <button type="button" className="hx-pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused
              ? <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>}
            <span>{paused ? "Play" : "Pause"}</span>
          </button>
        </div>
        {children}
      </div>
    </section>
  );
}
