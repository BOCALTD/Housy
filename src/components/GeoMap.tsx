"use client";

import { useMemo, useState } from "react";
import { NIGERIA, cellFor, cluster, distanceKm, findPlace, type MapPoint } from "@/lib/geo-rules";

/**
 * A simple map of Nigeria drawn from the points it is given: no street tiles, no outside map service, nothing sent anywhere.
 * Nearby points are grouped into numbered circles; tap a circle to zoom in on it. Everything on the map is also listed in text
 * below it, so the map is never the only way to reach a property.
 */

// A simplified outline of Nigeria as longitude, latitude pairs. It is for orientation only.
const OUTLINE: [number, number][] = [[2.7, 6.4], [3.4, 6.4], [4.3, 6.2], [5.0, 5.9], [5.6, 5.0], [6.2, 4.3], [7.0, 4.4], [7.6, 4.35], [8.3, 4.6], [8.6, 4.8], [8.7, 5.4], [9.0, 5.9], [9.4, 6.45], [10.1, 7.0], [11.0, 6.8], [11.4, 6.5], [11.8, 7.0], [12.2, 8.0], [12.8, 8.5], [13.0, 9.0], [13.7, 10.0], [14.0, 10.9], [14.6, 11.6], [14.4, 12.6], [13.9, 13.4], [13.0, 13.6], [12.0, 13.4], [11.0, 13.4], [9.0, 12.9], [7.5, 13.3], [6.0, 13.7], [4.5, 13.7], [3.6, 11.7], [3.7, 10.4], [3.0, 9.1], [2.75, 8.0], [2.7, 7.0]];

const W = 600, H = 540, FULL = NIGERIA.lngMax - NIGERIA.lngMin;
const COLOURS: Record<string, string> = { SALE: "#1f6f50", RENT: "#1d4ed8", LEASE: "#7c3aed", OCCUPIED: "#1f6f50", VACANT: "#b45309", ACTIVE: "#1d4ed8", UNDER_RENOVATION: "#7c3aed", VACANCY: "#b45309" };

export default function GeoMap({ points, caption, unit = "properties" }: { points: MapPoint[]; caption: string; unit?: string }) {
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState<{ lat: number; lng: number }>({ lat: 9.08, lng: 8.68 });
  const [picked, setPicked] = useState<MapPoint[] | null>(null);
  const [near, setNear] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [radius, setRadius] = useState(0);
  const [place, setPlace] = useState("");
  const [msg, setMsg] = useState("");

  const shown = useMemo(() => (near && radius > 0 ? points.filter((p) => distanceKm(near, p) <= radius) : points), [points, near, radius]);
  const spanLng = FULL / 2 ** (zoom - 1), spanLat = (spanLng * H) / W;
  const x0 = centre.lng - spanLng / 2, y0 = centre.lat + spanLat / 2;
  const px = (lng: number) => ((lng - x0) / spanLng) * W, py = (lat: number) => ((y0 - lat) / spanLat) * H;
  const clusters = useMemo(() => cluster(shown, cellFor(zoom)), [shown, zoom]);
  const maxCount = Math.max(1, ...clusters.map((c) => c.count));
  const outline = OUTLINE.map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join(" ");

  const go = (z: number, c = centre) => { setZoom(Math.min(6, Math.max(1, z))); setCentre(c); };
  const nudge = (dLat: number, dLng: number) => setCentre((c) => ({ lat: c.lat + dLat * spanLat * 0.4, lng: c.lng + dLng * spanLng * 0.4 }));

  function findNear(e: React.FormEvent) {
    e.preventDefault();
    const p = findPlace(place);
    if (!p) { setMsg("That place is not in the list. Try a city, area or state name."); return; }
    setNear({ lat: p.lat, lng: p.lng, label: p.name }); if (!radius) setRadius(25); go(4, { lat: p.lat, lng: p.lng }); setMsg("");
  }
  function useMyLocation() {
    if (!navigator.geolocation) { setMsg("Your browser cannot share its location."); return; }
    navigator.geolocation.getCurrentPosition(
      (g) => { const here = { lat: g.coords.latitude, lng: g.coords.longitude }; setNear({ ...here, label: "your location" }); if (!radius) setRadius(10); go(5, here); setMsg(""); },
      () => setMsg("Your location was not shared. You can type a place instead."), { timeout: 8000 },
    );
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={findNear} style={{ flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label className="field" style={{ flex: "1 1 180px" }}>Near<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="City, area or state" maxLength={60} /></label>
        <label className="field">Within<select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Distance"><option value={0}>Anywhere</option>{[5, 10, 25, 50, 100].map((r) => <option key={r} value={r}>{r} km</option>)}</select></label>
        <button className="btn" type="submit">Go</button>
        <button className="btn" type="button" onClick={useMyLocation}>Use my location</button>
        {near ? <button className="btn" type="button" onClick={() => { setNear(null); setRadius(0); setPlace(""); go(1, { lat: 9.08, lng: 8.68 }); }}>Clear</button> : null}
      </form>
      {msg ? <p className="small" role="status">{msg}</p> : null}
      <p className="small muted">{near && radius ? `${shown.length} of ${points.length} ${unit} within ${radius} km of ${near.label}. Your location, if you share it, stays in your browser.` : `${points.length} ${unit} on the map.`}</p>

      <div className="card" style={{ padding: 8, position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={caption} style={{ width: "100%", height: "auto", display: "block", background: "var(--surface-2, #f4f6f5)", borderRadius: 8, touchAction: "manipulation" }}>
          <polygon points={outline} fill="var(--surface, #fff)" stroke="var(--line, #9ca3af)" strokeWidth={1.5} />
          {near ? <circle cx={px(near.lng)} cy={py(near.lat)} r={radius ? Math.max(6, (radius / 111 / spanLat) * H) : 6} fill="rgba(29,78,216,.08)" stroke="#1d4ed8" strokeDasharray="4 3" /> : null}
          {clusters.map((c, i) => {
            const r = 11 + 16 * Math.sqrt(c.count / maxCount);
            const colour = COLOURS[c.points[0].group ?? ""] ?? "#1f6f50";
            const label = c.count === 1 ? c.points[0].label : `${c.count} ${unit} in this area`;
            return (
              <g key={i} role="button" tabIndex={0} aria-label={label} style={{ cursor: "pointer" }}
                onClick={() => { if (c.count > 1 && zoom < 6) go(zoom + 2, { lat: c.lat, lng: c.lng }); setPicked(c.points); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (c.count > 1 && zoom < 6) go(zoom + 2, { lat: c.lat, lng: c.lng }); setPicked(c.points); } }}>
                <circle cx={px(c.lng)} cy={py(c.lat)} r={Math.max(r, 22)} fill="transparent" />
                <circle cx={px(c.lng)} cy={py(c.lat)} r={r} fill={colour} fillOpacity={c.approximate ? 0.55 : 0.85} stroke="#fff" strokeWidth={2} />
                <text x={px(c.lng)} y={py(c.lat) + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff" style={{ pointerEvents: "none" }}>{c.count > 1 ? c.count : ""}</text>
              </g>
            );
          })}
        </svg>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }} role="group" aria-label="Map controls">
          <button className="btn" type="button" style={{ minWidth: 44, minHeight: 44 }} onClick={() => go(zoom + 1)} aria-label="Zoom in" disabled={zoom >= 6}>+</button>
          <button className="btn" type="button" style={{ minWidth: 44, minHeight: 44 }} onClick={() => go(zoom - 1)} aria-label="Zoom out" disabled={zoom <= 1}>−</button>
          <button className="btn" type="button" style={{ minHeight: 44 }} onClick={() => nudge(1, 0)} aria-label="Move north">North</button>
          <button className="btn" type="button" style={{ minHeight: 44 }} onClick={() => nudge(-1, 0)} aria-label="Move south">South</button>
          <button className="btn" type="button" style={{ minHeight: 44 }} onClick={() => nudge(0, -1)} aria-label="Move west">West</button>
          <button className="btn" type="button" style={{ minHeight: 44 }} onClick={() => nudge(0, 1)} aria-label="Move east">East</button>
          <button className="btn" type="button" style={{ minHeight: 44 }} onClick={() => go(1, { lat: 9.08, lng: 8.68 })}>Whole country</button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>Simplified outline for orientation, not to scale. Paler circles are placed at the centre of a city or area, not at a street address.</p>
      </div>

      {picked ? (
        <section className="card stack" aria-live="polite">
          <div className="row between"><h3>{picked.length === 1 ? "Selected" : `${picked.length} ${unit} here`}</h3><button className="btn small" type="button" onClick={() => setPicked(null)}>Close</button></div>
          <ul className="timeline">{picked.slice(0, 6).map((p) => <li key={p.id}><div>{p.href ? <a href={p.href}>{p.label}</a> : p.label}</div></li>)}</ul>
          {picked.length > 6 ? <details className="inline"><summary>Show {picked.length - 6} more</summary><ul className="timeline">{picked.slice(6, 60).map((p) => <li key={p.id}><div>{p.href ? <a href={p.href}>{p.label}</a> : p.label}</div></li>)}</ul></details> : null}
        </section>
      ) : null}

      <details className="inline"><summary>List all {shown.length} {unit} as text</summary>
        <ul className="timeline">{shown.slice(0, 40).map((p) => <li key={p.id}><div>{p.href ? <a href={p.href}>{p.label}</a> : p.label}</div></li>)}</ul>
        {shown.length > 40 ? <p className="small muted">Showing 40. Narrow the search or zoom in to see the rest.</p> : null}
      </details>
    </div>
  );
}
