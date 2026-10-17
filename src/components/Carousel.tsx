"use client";
import { useEffect, useRef, useState } from "react";

/** A row of cards you can swipe or step through with arrows, so a long list never stretches the page. */
export function Carousel({ children, label, few = false }: { children: React.ReactNode; label: string; few?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = () => {
    const t = track.current; if (!t) return;
    setEdge({ start: t.scrollLeft < 4, end: t.scrollLeft + t.clientWidth >= t.scrollWidth - 4 });
  };
  useEffect(() => { update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update); }, []);
  const step = (dir: number) => { const t = track.current; if (t) t.scrollBy({ left: dir * Math.max(240, t.clientWidth * 0.85), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
  const hideArrows = edge.start && edge.end;
  return (
    <div className="carousel" role="region" aria-roledescription="carousel" aria-label={label}>
      <div className={`carousel-track${few ? " few" : ""}`} ref={track} onScroll={update}>{children}</div>
      {!hideArrows ? (
        <div className="carousel-ctl">
          <button type="button" className="carousel-btn" aria-label="Previous" disabled={edge.start} onClick={() => step(-1)}>‹</button>
          <button type="button" className="carousel-btn" aria-label="Next" disabled={edge.end} onClick={() => step(1)}>›</button>
        </div>
      ) : null}
    </div>
  );
}
