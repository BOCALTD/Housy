"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export interface PromoSlide { href: string; title: string; place: string; purpose: string; name: string; tagline: string; pct: number; was: string; now: string; save: string; ends: string; theme: string }

const THEME_CLASS: Record<string, string> = { RED: "t-red", GOLD: "t-gold", GREEN: "t-green", PURPLE: "t-purple", BLUE: "t-blue" };
const PIECES = ["#FFE08A", "#FFFFFF", "#9CD3F5", "#FFB3D1", "#B8F0C8", "#FFD66B"];

/** The festive slideshow of properties on promotion: swipe, arrows, dots, and a pause button (it moves by itself unless the person prefers less motion). */
export function PromoSlides({ slides }: { slides: PromoSlide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [calm, setCalm] = useState(true);
  useEffect(() => { setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);

  const go = useCallback((n: number) => {
    const t = track.current; if (!t) return;
    const k = (n + slides.length) % slides.length;
    t.scrollTo({ left: k * t.clientWidth, behavior: calm ? "auto" : "smooth" });
    setI(k);
  }, [slides.length, calm]);

  useEffect(() => {
    if (calm || paused || hover || slides.length < 2) return;
    const id = window.setInterval(() => go(i + 1), 6000);
    return () => window.clearInterval(id);
  }, [calm, paused, hover, i, go, slides.length]);

  const onScroll = () => { const t = track.current; if (t) setI(Math.round(t.scrollLeft / Math.max(1, t.clientWidth))); };

  return (
    <section className="slides" aria-roledescription="carousel" aria-label="Properties on promotion"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="slides-head">
        <span className="slides-badge">Festive offers</span>
        {!calm && slides.length > 1 ? <button type="button" className="slides-pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>{paused ? "Play" : "Pause"}</button> : null}
      </div>
      <div className="slides-track" ref={track} onScroll={onScroll} aria-live={paused || calm ? "polite" : "off"}>
        {slides.map((s, n) => (
          <article key={s.href} className={`slide ${THEME_CLASS[s.theme] ?? "t-red"}`} role="group" aria-roledescription="slide" aria-label={`${n + 1} of ${slides.length}`}>
            <span className="confetti" aria-hidden="true">
              {Array.from({ length: 12 }, (_, k) => <i key={k} style={{ "--x": `${(k * 41 + n * 13 + 6) % 96}%`, "--d": `${(k % 6) * -0.8}s`, "--c": PIECES[k % PIECES.length], "--r": `${(k * 47) % 180}deg` } as React.CSSProperties} />)}
            </span>
            <div className="slide-copy">
              <span className="slide-eyebrow">{s.name} · {s.purpose}</span>
              <h2>{s.title}</h2>
              <p>{s.place}{s.tagline ? ` · ${s.tagline}` : ""}</p>
              <span className="slide-price"><span className="sr-only">Was </span><s>{s.was}</s><span className="sr-only"> now </span><b>{s.now}</b></span>
              <p className="small">You save {s.save}. Offer ends {s.ends}.</p>
              <Link className="btn" href={s.href}>View this property</Link>
            </div>
            <div className="burst" aria-label={`${s.pct} percent off`}><span aria-hidden="true">{s.pct}%<small>OFF</small></span></div>
          </article>
        ))}
      </div>
      {slides.length > 1 ? (
        <div className="slides-nav">
          <button type="button" className="slides-arrow" aria-label="Previous offer" onClick={() => go(i - 1)}>‹</button>
          {slides.map((s, n) => <button key={s.href} type="button" aria-label={`Show offer ${n + 1}`} aria-current={n === i ? "true" : undefined} onClick={() => go(n)}><span className="dot" /></button>)}
          <button type="button" className="slides-arrow" aria-label="Next offer" onClick={() => go(i + 1)}>›</button>
        </div>
      ) : null}
    </section>
  );
}
