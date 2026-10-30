"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";

const KEY = "intro-done";

/**
 * Four welcome slides for someone visiting for the first time, behind the opening loader's doors: the idea behind the
 * platform, then how it works, told as one story, each over its own moving picture. "Skip" and "Next" sit at the top right;
 * the last slide leads to creating an account. Shown once per browser, never to someone signed in, and with still pictures
 * for people who have asked their device for less motion.
 */
export function FirstVisitIntro({ signedIn, name, preview }: { signedIn: boolean; name: string; /** Open on this slide straight away (design checks). */ preview?: number }) {
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(preview !== undefined);
  const [i, setI] = useState(preview ?? 0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const forced = params.get("intro") === "1";
    let seen = false;
    try { seen = !!localStorage.getItem(KEY); } catch { /* storage blocked: show it, it can be skipped */ }
    if (forced || (!signedIn && path === "/" && !seen && !navigator.webdriver)) setOpen(true);
  }, [signedIn, path, params]);

  const close = useCallback(() => {
    try { localStorage.setItem(KEY, new Date().toISOString()); } catch { /* fine */ }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("intro-on");
    box.current?.querySelector<HTMLElement>(".intro-top button")?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((x) => Math.min(SLIDES.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); document.documentElement.classList.remove("intro-on"); };
  }, [open, close]);

  if (!open) return null;
  const s = SLIDES[i], last = i === SLIDES.length - 1;
  return (
    <div className="intro" ref={box} role="dialog" aria-modal="true" aria-roledescription="welcome slides" aria-label={`Welcome to ${name}`}
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={(e) => {
        const st = touch.current; touch.current = null; if (!st) return;
        const t = e.changedTouches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
        if (Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx)) setI((x) => Math.max(0, Math.min(SLIDES.length - 1, x + (dx < 0 ? 1 : -1))));
      }}>
      {SLIDES.map((sl, k) => <div key={sl.id} className={`intro-bg intro-bg-${sl.id}${k === i ? " on" : ""}`} aria-hidden="true">{sl.art}</div>)}
      <div className="intro-shade" aria-hidden="true" />

      <div className="intro-top">
        <span className="intro-brand"><Logo height={30} tone="light" /></span>
        <span className="intro-nav">
          {!last ? <button type="button" className="intro-link" onClick={close}>Skip</button> : null}
          {!last ? <button type="button" className="intro-link intro-next" onClick={() => setI(i + 1)}>Next <span aria-hidden="true">→</span></button> : <button type="button" className="intro-link" onClick={close}>Close</button>}
        </span>
      </div>

      <section className="intro-copy" key={s.id} aria-live="polite">
        <p className="intro-kicker">{s.kicker(name)}</p>
        <h2>{s.title}</h2>
        <p className="intro-text">{s.text(name)}</p>
        {last ? (
          <div className="intro-cta">
            <Link className="btn primary intro-go" href="/join" onClick={close}>Create my free account</Link>
            <Link className="btn intro-ghost" href="/login" onClick={close}>I already have an account</Link>
            <button type="button" className="intro-link intro-later" onClick={close}>Look around first</button>
          </div>
        ) : null}
      </section>

      <div className="intro-foot">
        <div className="intro-dots" role="tablist" aria-label="Slides">
          {SLIDES.map((sl, k) => (
            <button key={sl.id} type="button" role="tab" aria-selected={k === i} aria-label={`Slide ${k + 1} of ${SLIDES.length}: ${sl.title}`} className={`intro-dot${k === i ? " on" : ""}`} onClick={() => setI(k)}><i /></button>
          ))}
        </div>
        {i > 0 ? <button type="button" className="intro-link" onClick={() => setI(i - 1)}><span aria-hidden="true">←</span> Back</button> : <span />}
      </div>
    </div>
  );
}

const SLIDES: { id: string; kicker: (n: string) => string; title: string; text: (n: string) => string; art: React.ReactNode }[] = [
  {
    id: "welcome",
    kicker: (n) => `Welcome to ${n}`,
    title: "Home should feel safe from the very first search.",
    text: (n) => `Too many people have paid for an inspection that never happened, or for a flat that was never for rent. ${n} began with one idea: put every property, agent and company where you can check them before you trust them.`,
    art: (
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
        <defs><linearGradient id="ib-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#14161A" /><stop offset=".65" stopColor="#3A2A12" /><stop offset="1" stopColor="#B87500" /></linearGradient></defs>
        <rect width="400" height="300" fill="url(#ib-sky)" />
        <circle className="ib-sun" cx="200" cy="250" r="46" fill="#FBB017" />
        {[[10, 150, 40], [55, 120, 34], [95, 170, 30], [130, 100, 44], [180, 140, 36], [222, 90, 40], [268, 130, 34], [306, 110, 42], [352, 160, 40]].map(([x, y, w], k) => (
          <g key={k}>
            <rect x={x} y={y} width={w} height={300 - y} fill="#0E0F12" />
            {Array.from({ length: Math.floor((300 - y) / 22) }).map((_, r) => [0, 1, 2].map((c) => (
              <rect key={`${r}-${c}`} className="ib-win" style={{ animationDelay: `${((k * 7 + r * 3 + c * 5) % 23) / 5}s` }} x={x + 5 + c * ((w - 10) / 3)} y={y + 10 + r * 22} width={(w - 16) / 3} height="8" rx="1" fill="#FBB017" />
            )))}
          </g>
        ))}
        {[60, 160, 280, 340].map((x, k) => (
          <path key={x} className="ib-float" style={{ animationDelay: `${k * 1.4}s` }} d={`M${x} 90l14-12 14 12v14h-28z`} fill="none" stroke="#FBB017" strokeWidth="2" strokeLinejoin="round" />
        ))}
      </svg>
    ),
  },
  {
    id: "search",
    kicker: () => "Chapter 2 · Find",
    title: "Search with the facts in front of you.",
    text: () => "Every listing comes from a registered company and is checked before it goes live. See it on the map, watch its reel, know what similar homes cost in that area, and compare your favourites side by side.",
    art: (
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
        <rect width="400" height="300" fill="#16181C" />
        <g stroke="#2C3036" strokeWidth="1">{Array.from({ length: 21 }).map((_, k) => <path key={`v${k}`} d={`M${k * 20} 0v300`} />)}{Array.from({ length: 16 }).map((_, k) => <path key={`h${k}`} d={`M0 ${k * 20}h400`} />)}</g>
        <path d="M-10 210C80 180 120 230 200 190s150-60 220-30" fill="none" stroke="#3A3F47" strokeWidth="10" />
        <path d="M120 -10c10 90-30 150 20 220s20 90 10 100" fill="none" stroke="#3A3F47" strokeWidth="8" />
        <circle className="is-radar" cx="210" cy="150" r="20" fill="none" stroke="#FBB017" strokeWidth="2" />
        <circle className="is-radar is-radar-2" cx="210" cy="150" r="20" fill="none" stroke="#FBB017" strokeWidth="2" />
        {[[150, 110], [250, 120], [200, 200], [300, 180], [110, 170], [270, 80]].map(([x, y], k) => (
          <g key={k} transform={`translate(${x} ${y})`}><g className="is-pin" style={{ animationDelay: `${0.3 + k * 0.45}s` }}>
            <path d="M0 0c-9-12-14-18-14-25a14 14 0 0 1 28 0c0 7-5 13-14 25Z" fill={k % 3 === 0 ? "#22C55E" : "#FBB017"} />
            <circle cy="-25" r="5" fill="#16181C" />
          </g></g>
        ))}
        <g className="is-lens"><circle cx="0" cy="0" r="26" fill="rgba(251,176,23,.12)" stroke="#fff" strokeWidth="4" /><path d="M19 19l20 20" stroke="#fff" strokeWidth="6" strokeLinecap="round" /></g>
      </svg>
    ),
  },
  {
    id: "safe",
    kicker: () => "Chapter 3 · Visit",
    title: "Visit safely. Pay only when you are sure.",
    text: (n) => `Book inspections through ${n}, share your trip with someone you trust, and read reviews from people who really closed a deal. Badges show who has passed identity and business checks. Never pay before you inspect.`,
    art: (
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
        <defs><radialGradient id="iv-glow" cx="50%" cy="45%"><stop offset="0" stopColor="#3A2C10" /><stop offset="1" stopColor="#121316" /></radialGradient></defs>
        <rect width="400" height="300" fill="url(#iv-glow)" />
        <g className="iv-orbit" style={{ transformOrigin: "200px 140px" }}>
          {[0, 72, 144, 216, 288].map((a) => (
            <g key={a} transform={`rotate(${a} 200 140) translate(200 40)`}><circle r="12" fill="#2A2D33" stroke="#FBB017" strokeWidth="2" /><path d="M-5 0l3 3 6-6" fill="none" stroke="#22C55E" strokeWidth="2.4" strokeLinecap="round" /></g>
          ))}
        </g>
        <path className="iv-shield" d="M200 70l60 22v42c0 40-26 66-60 80-34-14-60-40-60-80V92z" fill="rgba(251,176,23,.08)" stroke="#FBB017" strokeWidth="5" strokeLinejoin="round" />
        <path className="iv-check" d="M174 140l18 18 36-38" fill="none" stroke="#22C55E" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <g className="iv-key" style={{ transformOrigin: "320px 210px" }}><circle cx="320" cy="210" r="14" fill="none" stroke="#C9CDD3" strokeWidth="5" /><path d="M320 224v40m0-12h10m-10 10h8" stroke="#C9CDD3" strokeWidth="5" strokeLinecap="round" /></g>
      </svg>
    ),
  },
  {
    id: "together",
    kicker: () => "Chapter 4 · Belong",
    title: "One place for everyone in the deal.",
    text: (n) => `Renters, buyers and flatmates find their next home. Agents build a name clients can trust. Companies run listings, tenants, rent and documents from one workspace. Create your free ${n} account and start where you are.`,
    art: (
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
        <rect width="400" height="300" fill="#141518" />
        {[[200, 150, 120, 80], [200, 150, 290, 90], [200, 150, 310, 210], [200, 150, 110, 220], [200, 150, 70, 140], [120, 80, 70, 140], [290, 90, 310, 210], [110, 220, 310, 210]].map(([a, b, c, d], k) => (
          <path key={k} className="it-line" style={{ animationDelay: `${k * 0.35}s` }} d={`M${a} ${b}L${c} ${d}`} stroke="#FBB017" strokeOpacity=".55" strokeWidth="2" />
        ))}
        {[[120, 80], [290, 90], [310, 210], [110, 220], [70, 140]].map(([x, y], k) => (
          <g key={k} transform={`translate(${x} ${y})`}><g className="it-node" style={{ animationDelay: `${k * 0.5}s` }}>
            <circle r="20" fill="#2A2D33" stroke="#FBB017" strokeWidth="2" /><circle cy="-5" r="6" fill="#C9CDD3" /><path d="M-10 11a10 10 0 0 1 20 0" fill="#C9CDD3" />
          </g></g>
        ))}
        <g transform="translate(200 150)"><g className="it-core"><circle r="34" fill="#FBB017" /></g><path d="M-15 2 0-11 15 2M-10 0v14h20V0" fill="none" stroke="#1F2125" strokeWidth="4" strokeLinejoin="round" /></g>
        {[[40, 40], [350, 40], [360, 270], [30, 280]].map(([x, y], k) => <rect key={k} className="ib-float" style={{ animationDelay: `${k}s` }} x={x} y={y} width="18" height="24" rx="3" fill="none" stroke="#C9CDD3" strokeOpacity=".5" strokeWidth="2" />)}
      </svg>
    ),
  },
];
