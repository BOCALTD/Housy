"use client";
import { useEffect, useState } from "react";

const SLIDES = [
  { title: <>Find property, then <em className="hl">verify it before you buy.</em></>, text: "Every listing here is submitted by a registered company and reviewed before it is published." },
  { title: <>Homes, land and shops <em className="hl">across Nigeria.</em></>, text: "Search by city, price and bedrooms, or describe what you want in a sentence." },
  { title: <>Selling or letting? <em className="hl">Reach serious buyers.</em></>, text: "Register your company, list your property, and manage tenants, deals and documents in one place." },
];

/** The home page headline as a slideshow: it changes by itself every few seconds (not at all for people who prefer less motion), and has dots to choose a slide. */
export function HeroRotator() {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const [calm, setCalm] = useState(true);
  useEffect(() => { setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => {
    if (calm || hold) return;
    const id = window.setTimeout(() => setI((n) => (n + 1) % SLIDES.length), 6500);
    return () => window.clearTimeout(id);
  }, [calm, hold, i]);
  return (
    <div className="hero-rot" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <p className="eyebrow" style={{ color: "inherit", opacity: .85 }}>Property in Nigeria</p>
      <h1 className="visually-hidden">Find property, then verify it before you buy</h1>
      <div className="hero-slides" aria-live={calm || hold ? "polite" : "off"}>
        {SLIDES.map((s, n) => (
          <div key={n} className={`hero-slide${n === i ? " on" : ""}`} aria-hidden={n === i ? undefined : true}>
            <p className="hero-title">{s.title}</p>
            <p className="hero-text">{s.text}</p>
          </div>
        ))}
      </div>
      <div className="hero-dots" role="group" aria-label="Choose a message">
        {SLIDES.map((_, n) => <button key={n} type="button" aria-label={`Message ${n + 1} of ${SLIDES.length}`} aria-current={n === i ? "true" : undefined} onClick={() => setI(n)}><span className="dot" /></button>)}
      </div>
    </div>
  );
}
