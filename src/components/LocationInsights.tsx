"use client";

import { useEffect, useState } from "react";
import { StreetMap, type StaticPoint } from "@/components/StreetMap";
import { directionsLinks, distanceLabel, minutesLabel, type NearbySummary } from "@/lib/location-rules";

const DOT: Record<string, string> = { school: "#2563eb", health: "#dc2626", pharmacy: "#16a34a", shopping: "#9333ea", bank: "#0f766e", fuel: "#ea580c", transport: "#475569", food: "#d97706", worship: "#7c3aed", park: "#15803d", police: "#1e3a8a" };
const PLACE_KEY = "travel-from";

type Nearby = { available: true; centre: { lat: number; lng: number }; summary: NearbySummary[] } | { available: false; reason: string };
type Travel = { kind: "route"; km: number; minutes: number; to: { lat: number; lng: number } } | { kind: "estimate"; estimate: { roadKm: number; car: { minMin: number; maxMin: number }; walkMin: number | null }; to: { lat: number; lng: number } };
type Place = { label: string; lat: number; lng: number };

/**
 * The "Where it is" section of a property page: the area (and the site outline when the company shows one) on the map, what is
 * within walking distance, and how long it takes to get there from a place the visitor chooses.
 */
export function LocationInsights({ refId, title, centre, boundary }: { refId: string; title: string; centre: { lat: number; lng: number }; boundary: [number, number][] | null }) {
  const [nearby, setNearby] = useState<Nearby | null>(null);
  const [kinds, setKinds] = useState<string[]>([]);
  const [from, setFrom] = useState<Place | null>(null);
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [travel, setTravel] = useState<Travel | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/map/nearby?ref=${encodeURIComponent(refId)}`).then((r) => (r.ok ? r.json() : { available: false, reason: "unavailable" })).then((n: Nearby) => {
      if (!live) return;
      setNearby(n);
      if (n.available) setKinds(n.summary.slice(0, 4).map((s) => s.kind));
    }).catch(() => live && setNearby({ available: false, reason: "unavailable" }));
    try { const saved = window.localStorage.getItem(PLACE_KEY); if (saved) setFrom(JSON.parse(saved) as Place); } catch { /* optional */ }
    return () => { live = false; };
  }, [refId]);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setPlaces([]); return; }
    const id = setTimeout(() => {
      void fetch(`/api/map/places?q=${encodeURIComponent(t)}`).then((r) => (r.ok ? r.json() : { places: [] })).then((r: { places: Place[] }) => setPlaces(r.places)).catch(() => setPlaces([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    if (!from) { setTravel(null); return; }
    let live = true;
    setNote("");
    fetch(`/api/map/travel?ref=${encodeURIComponent(refId)}&from=${from.lat.toFixed(5)},${from.lng.toFixed(5)}`)
      .then((r) => (r.ok ? r.json() : null)).then((t: Travel | null) => { if (live) { setTravel(t); if (!t) setNote("The travel time could not be worked out just now."); } })
      .catch(() => live && setNote("The travel time could not be worked out just now."));
    return () => { live = false; };
  }, [from, refId]);

  const choose = (p: Place) => {
    setFrom(p); setQ(""); setPlaces([]);
    try { window.localStorage.setItem(PLACE_KEY, JSON.stringify(p)); } catch { /* optional */ }
  };
  const useMyLocation = () => {
    if (!("geolocation" in navigator)) { setNote("This browser cannot share your location. Search for a place instead."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ label: "Where you are now", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setNote("Your location was not shared. Search for a place instead."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const extras: StaticPoint[] = nearby?.available
    ? nearby.summary.filter((s) => kinds.includes(s.kind)).flatMap((s) => s.nearest.map((n, k) => ({ id: `${s.kind}-${k}`, lat: n.lat, lng: n.lng, label: n.name, sub: `${s.label.replace(/s$/, "")} · ${distanceLabel(n.km)}`, group: s.kind })))
    : [];
  const links = travel ? directionsLinks(travel.to, from) : null;

  return (
    <div className="stack">
      <StreetMap key={kinds.join(",")} mode="area" centre={centre} boundary={boundary} extras={extras} label={`Area around ${title}`} />
      <p className="small muted">The shaded circle shows the area, about a kilometre wide. {boundary ? "The dashed outline is the site, as drawn by the company. " : ""}The company gives the exact address when you arrange an inspection.</p>

      <section className="nearby" aria-labelledby="nearby-h">
        <h3 id="nearby-h">What is nearby</h3>
        {nearby === null ? <p className="small muted">Looking up schools, hospitals, markets and transport nearby…</p>
          : !nearby.available ? <p className="small muted">{nearby.reason === "off" ? "Nearby places are switched off on this site." : "Nearby places are not available just now."}</p>
          : nearby.summary.length === 0 ? <p className="small muted">No schools, shops or other places are recorded within about 1.5 km on the public map.</p>
          : (
            <>
              <div className="row" role="group" aria-label="Show on the map">
                {nearby.summary.map((s) => (
                  <label key={s.kind} className="chip-toggle">
                    <input type="checkbox" checked={kinds.includes(s.kind)} onChange={(e) => setKinds((k) => e.target.checked ? [...k, s.kind] : k.filter((x) => x !== s.kind))} />
                    <span className="nearby-dot" style={{ background: DOT[s.kind] }} aria-hidden="true" />{s.label}
                  </label>
                ))}
              </div>
              <ul className="nearby-grid">
                {nearby.summary.slice(0, 6).map((s) => <NearbyKind key={s.kind} s={s} />)}
              </ul>
              {nearby.summary.length > 6 ? (
                <details className="inline"><summary>Show {nearby.summary.length - 6} more kinds of place</summary>
                  <ul className="nearby-grid">{nearby.summary.slice(6).map((s) => <NearbyKind key={s.kind} s={s} />)}</ul>
                </details>
              ) : null}
              <p className="small muted">Within about 1.5 km of the area, from OpenStreetMap. Distances are in a straight line.</p>
            </>
          )}
      </section>

      <section className="stack" aria-labelledby="travel-h">
        <h3 id="travel-h">How long to get there</h3>
        <div className="map-tools">
          <div className="map-search">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="From your work, school or another area" aria-label="Travel from a place" autoComplete="off" />
            {places.length ? <ul className="map-places" aria-label="Places">{places.map((p) => <li key={p.label}><button type="button" onClick={() => choose(p)}>{p.label}</button></li>)}</ul> : null}
          </div>
          <button type="button" className="btn" onClick={useMyLocation}>From where I am</button>
        </div>
        {from && travel ? (
          <div className="travel-result" aria-live="polite">
            <span className="small muted">From {from.label}</span>
            {travel.kind === "route"
              ? <strong>About {minutesLabel(travel.minutes)} by car · {distanceLabel(travel.km)} by road</strong>
              : <strong>About {minutesLabel(travel.estimate.car.minMin)} to {minutesLabel(travel.estimate.car.maxMin)} by car{travel.estimate.walkMin ? ` · ${minutesLabel(travel.estimate.walkMin)} on foot` : ""}</strong>}
            <span className="small muted">{travel.kind === "route" ? "Without traffic, to the area of the property." : `About ${distanceLabel(travel.estimate.roadKm)} by road. An estimate: the low figure is for quiet roads, the high one for rush hour.`}</span>
            {links ? <div className="directions"><a className="btn small" href={links.google} target="_blank" rel="noopener noreferrer">Google Maps</a><a className="btn small" href={links.apple} target="_blank" rel="noopener noreferrer">Apple Maps</a><a className="btn small" href={links.waze} target="_blank" rel="noopener noreferrer">Waze</a></div> : null}
          </div>
        ) : !from ? <p className="small muted">Choose a place you travel to often to see how long the journey takes. It is remembered on this device only.</p> : null}
        {note ? <p className="small" role="status">{note}</p> : null}
      </section>
    </div>
  );
}

function NearbyKind({ s }: { s: NearbySummary }) {
  return (
    <li className="nearby-kind">
      <header><strong><span className="nearby-dot" style={{ background: DOT[s.kind] }} aria-hidden="true" />{s.label}</strong><span className="nearby-count">{s.count}</span></header>
      <ul>{s.nearest.map((n) => <li key={`${n.name}-${n.lat}`}><span>{n.name}</span><span>{distanceLabel(n.km)}</span></li>)}</ul>
    </li>
  );
}

