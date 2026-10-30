"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { BOUNDARY_MAX_POINTS, RADII_KM, areaLabel, boundaryAreaSqm, checkBoundary, mapLayers } from "@/lib/location-rules";

/**
 * A real street map (OpenStreetMap tiles by default, or the provider set in NEXT_PUBLIC_MAP_TILES), with a satellite layer when
 * the provider offers one (see mapLayers).
 * Modes:
 *  - "listings": published properties in the visible area, loaded as the map moves, with a list beside it; or, with a radius,
 *    every property within that distance of a point, nearest first;
 *  - "points": a fixed set of markers (a company's portfolio, vacancy areas); with `route`, joined in order as a day's route;
 *  - "pick": one draggable pin to choose a position, written to hidden form fields;
 *  - "area": a shaded circle around one listing's approximate area (or an exact pin), with an optional site outline and
 *    nearby places;
 *  - "draw": tap to draw a site outline, written to a hidden form field.
 * The page never depends on the map: lists and forms carry the same information as text.
 */

// Written out in full so the build can put the values in the page.
const LAYERS = mapLayers({
  NEXT_PUBLIC_MAP_TILES: process.env.NEXT_PUBLIC_MAP_TILES, NEXT_PUBLIC_MAP_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
  NEXT_PUBLIC_MAP_SATELLITE_TILES: process.env.NEXT_PUBLIC_MAP_SATELLITE_TILES, NEXT_PUBLIC_MAP_SATELLITE_TILE_SIZE: process.env.NEXT_PUBLIC_MAP_SATELLITE_TILE_SIZE,
  NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION,
});
const LAYER_KEY = "map-layer";

export type View = { lat: number; lng: number; zoom: number };
type Pin = { kind: "pin"; ref: string; lat: number; lng: number; price: string; title: string; priceLabel: string; beds: number | null; city: string; purpose: string; photo: string | null; distance?: string };
type Group = { kind: "group"; lat: number; lng: number; count: number; minPrice: string };
type ViewData = { total: number; markers: (Pin | Group)[]; list: Pin[] };
export type StaticPoint = { id: string; lat: number; lng: number; label: string; href?: string; group?: string; weight?: number; approximate?: boolean; sub?: string };

const COLOURS: Record<string, string> = { school: "#2563eb", health: "#dc2626", pharmacy: "#16a34a", shopping: "#9333ea", bank: "#0f766e", fuel: "#ea580c", transport: "#475569", food: "#d97706", worship: "#7c3aed", park: "#15803d", police: "#1e3a8a", SALE: "#0f766e", RENT: "#1d4ed8", LEASE: "#7c3aed", OCCUPIED: "#0f766e", VACANT: "#b45309", ACTIVE: "#1d4ed8", UNDER_RENOVATION: "#7c3aed", VACANCY: "#b45309" };

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function loadLeaflet(): Promise<typeof Leaflet> {
  const mod = await import("leaflet");
  return (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
}

function makeMap(L: typeof Leaflet, el: HTMLElement, view: View, label: string) {
  const calm = reducedMotion();
  const map = L.map(el, { zoomAnimation: !calm, fadeAnimation: !calm, markerZoomAnimation: !calm, worldCopyJump: true, minZoom: 2, maxZoom: 19 });
  const tiles = Object.fromEntries(LAYERS.map((l) => [l.label, L.tileLayer(l.url, { attribution: l.attribution, maxZoom: l.maxZoom, tileSize: l.tileSize, zoomOffset: l.zoomOffset, subdomains: "abc", crossOrigin: true })]));
  let chosen = LAYERS[0].label;
  try { const saved = window.localStorage.getItem(LAYER_KEY); if (saved && tiles[saved]) chosen = saved; } catch { /* storage is optional */ }
  tiles[chosen].addTo(map);
  // Streets or satellite, when a satellite source is set up. The choice is remembered on this device.
  if (LAYERS.length > 1) {
    L.control.layers(tiles, undefined, { position: "topright", collapsed: false }).addTo(map);
    map.on("baselayerchange", (e: Leaflet.LayersControlEvent) => { try { window.localStorage.setItem(LAYER_KEY, e.name); } catch { /* optional */ } });
  }
  map.setView([view.lat, view.lng], view.zoom);
  // Keep the required map-data credit; the library's own link is optional and only adds another small tap target.
  map.attributionControl.setPrefix(false);
  el.setAttribute("aria-label", label);
  el.setAttribute("role", "region");
  return map;
}

function text(tag: string, cls: string, value: string) {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = value;
  return e;
}

/** A popup card built from text nodes only, so nothing in a listing can inject markup. */
function pinCard(p: Pin) {
  const a = document.createElement("a");
  a.href = `/properties/${encodeURIComponent(p.ref)}`;
  a.className = "map-card";
  if (p.photo) {
    const img = document.createElement("img");
    img.src = `/photos/${encodeURIComponent(p.photo)}`;
    img.alt = "";
    img.loading = "lazy";
    a.appendChild(img);
  }
  a.appendChild(text("strong", "map-card-price", p.priceLabel));
  a.appendChild(text("span", "map-card-title", p.title));
  a.appendChild(text("span", "map-card-meta", [p.beds !== null ? `${p.beds} bed` : "", p.city, p.purpose === "SALE" ? "For sale" : p.purpose === "RENT" ? "To rent" : "To lease"].filter(Boolean).join(" · ")));
  a.appendChild(text("span", "map-card-link", "View property"));
  return a;
}

export type Near = { lat: number; lng: number; km: number };

export function StreetMap(props:
  | { mode: "listings"; start: View; filters: Record<string, string>; label?: string; near?: Near | null }
  | { mode: "points"; points: StaticPoint[]; start: View; label?: string; route?: boolean }
  | { mode: "pick"; start: View; value: { lat: number; lng: number } | null; label?: string }
  | { mode: "area"; centre: { lat: number; lng: number }; label?: string; exact?: boolean; boundary?: [number, number][] | null; extras?: StaticPoint[] }
  | { mode: "draw"; start: View; value: [number, number][] | null; label?: string; anchor?: { lat: number; lng: number } | null }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const [data, setData] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(props.mode === "pick" ? props.value : null);
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<{ label: string; lat: number; lng: number; zoom: number }[]>([]);
  const [note, setNote] = useState("");
  const [near, setNear] = useState<Near | null>(props.mode === "listings" ? props.near ?? null : null);
  const [radius, setRadius] = useState<number>(props.mode === "listings" && props.near ? props.near.km : 5);
  const [corners, setCorners] = useState<[number, number][]>(props.mode === "draw" ? props.value ?? [] : []);
  const drawRef = useRef<{ redraw: (c: [number, number][]) => void } | null>(null);
  const filtersKey = props.mode === "listings" ? JSON.stringify(props.filters) + JSON.stringify(near) : props.mode === "area" ? JSON.stringify(props.extras?.length ?? 0) : "";

  useEffect(() => {
    let alive = true;
    let map: Leaflet.Map | null = null;
    void (async () => {
      const L = await loadLeaflet();
      if (!alive || !box.current) return;
      const label = props.label ?? "Map";
      if (props.mode === "area") {
        map = makeMap(L, box.current, { ...props.centre, zoom: props.exact ? 16 : 14 }, label);
        if (props.exact) L.marker([props.centre.lat, props.centre.lng], { icon: L.divIcon({ className: "map-pick", html: "<span></span>", iconSize: [44, 44], iconAnchor: [22, 44] }), keyboard: true, title: "The property" }).addTo(map);
        else L.circle([props.centre.lat, props.centre.lng], { radius: 700, color: "#b7791f", weight: 2, fillColor: "#fbb017", fillOpacity: 0.25 }).addTo(map);
        if (props.boundary?.length) {
          const poly = L.polygon(props.boundary, { color: "#b45309", weight: 3, fillColor: "#fbb017", fillOpacity: 0.18, dashArray: "6 4" }).addTo(map);
          poly.bindTooltip("Site outline (drawn by the company)", { sticky: true });
          map.fitBounds(poly.getBounds().extend([props.centre.lat, props.centre.lng]), { padding: [30, 30], maxZoom: 17 });
        }
        for (const p of props.extras ?? []) {
          const colour = COLOURS[p.group ?? ""] ?? "#475569";
          const m = L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: colour, fillOpacity: 1 });
          const card = document.createElement("div");
          card.className = "map-card";
          card.appendChild(text("span", "map-card-title", p.label));
          if (p.sub) card.appendChild(text("span", "map-card-meta", p.sub));
          m.bindPopup(card, { maxWidth: 240 }).addTo(map);
        }
      } else if (props.mode === "draw") {
        const startAt = props.value?.length ? { lat: props.value[0][0], lng: props.value[0][1], zoom: 16 } : props.anchor ? { ...props.anchor, zoom: 16 } : props.start;
        map = makeMap(L, box.current, startAt, label);
        const layer = L.layerGroup().addTo(map);
        if (props.anchor) L.circleMarker([props.anchor.lat, props.anchor.lng], { radius: 6, color: "#1f2125", fillColor: "#fbb017", fillOpacity: 1, weight: 2 }).bindTooltip("The property's position").addTo(map);
        const redraw = (c: [number, number][]) => {
          layer.clearLayers();
          if (c.length >= 3) L.polygon(c, { color: "#b45309", weight: 3, fillColor: "#fbb017", fillOpacity: 0.2 }).addTo(layer);
          else if (c.length === 2) L.polyline(c, { color: "#b45309", weight: 3 }).addTo(layer);
          c.forEach((p, k) => L.marker(p, { icon: L.divIcon({ className: "map-corner", html: `<span>${k + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), keyboard: false }).addTo(layer));
        };
        drawRef.current = { redraw };
        redraw(props.value ?? []);
        if (props.value && props.value.length >= 3) map.fitBounds(L.latLngBounds(props.value), { padding: [30, 30], maxZoom: 18 });
        map.on("click", (e: Leaflet.LeafletMouseEvent) => setCorners((c) => {
          if (c.length >= BOUNDARY_MAX_POINTS) return c;
          const next: [number, number][] = [...c, [Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6]];
          redraw(next);
          return next;
        }));
      } else if (props.mode === "pick") {
        map = makeMap(L, box.current, props.value ? { ...props.value, zoom: 16 } : props.start, label);
        const icon = L.divIcon({ className: "map-pick", html: "<span></span>", iconSize: [44, 44], iconAnchor: [22, 44] });
        let marker: Leaflet.Marker | null = null;
        const place = (lat: number, lng: number) => {
          const pos = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
          setPicked(pos);
          if (!marker && map) {
            marker = L.marker([pos.lat, pos.lng], { icon, draggable: true, keyboard: true, title: "Property position (drag to move)" }).addTo(map);
            marker.on("dragend", () => { const p = marker!.getLatLng(); place(p.lat, p.lng); });
          } else marker?.setLatLng([pos.lat, pos.lng]);
        };
        if (props.value) place(props.value.lat, props.value.lng);
        map.on("click", (e: Leaflet.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
      } else if (props.mode === "points") {
        map = makeMap(L, box.current, props.start, label);
        const layer = L.layerGroup().addTo(map);
        for (const p of props.points) {
          const colour = COLOURS[p.group ?? ""] ?? "#b7791f";
          const m = p.weight && p.weight > 1
            ? L.circleMarker([p.lat, p.lng], { radius: Math.min(30, 10 + Math.sqrt(p.weight) * 3), color: colour, fillColor: colour, fillOpacity: 0.35, weight: 2 })
            : L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "map-dot", html: `<span style="background:${colour}"></span>`, iconSize: [44, 44], iconAnchor: [22, 22] }), keyboard: true, title: p.label });
          const card = document.createElement(p.href ? "a" : "div");
          if (p.href) (card as HTMLAnchorElement).href = p.href;
          card.className = "map-card";
          card.appendChild(text("span", "map-card-title", p.label));
          if (p.sub) card.appendChild(text("span", "map-card-meta", p.sub));
          if (p.approximate) card.appendChild(text("span", "map-card-meta", "Approximate position (area centre)"));
          m.bindPopup(card, { maxWidth: 260 });
          m.addTo(layer);
        }
        if (props.route && props.points.length > 1) {
          // A day's inspections joined in time order: straight lines between stops, numbered. Not road directions.
          L.polyline(props.points.map((p) => [p.lat, p.lng] as [number, number]), { color: "#1f2125", weight: 3, opacity: 0.7, dashArray: "8 6" }).addTo(layer);
          props.points.forEach((p, k) => L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "map-corner map-stop", html: `<span>${k + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false, interactive: false }).addTo(layer));
        }
        if (props.points.length) map.fitBounds(L.latLngBounds(props.points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 15 });
      } else {
        map = makeMap(L, box.current, props.start, label);
        const layer = L.layerGroup().addTo(map);
        let seq = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const load = async () => {
          if (!map) return;
          const my = ++seq;
          const b = map.getBounds(), z = map.getZoom();
          const params = near
            ? new URLSearchParams({ ...props.filters, near: `${near.lat.toFixed(5)},${near.lng.toFixed(5)}`, km: String(near.km), zoom: String(z) })
            : new URLSearchParams({ ...props.filters, bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(","), zoom: String(z) });
          setLoading(true);
          try {
            const res = await fetch(`/api/map/listings?${params.toString()}`);
            if (!res.ok) throw new Error(String(res.status));
            const v = (await res.json()) as ViewData;
            if (my !== seq || !alive || !map) return;
            layer.clearLayers();
            for (const m of v.markers) {
              if (m.kind === "group") {
                const size = m.count >= 1000 ? 64 : m.count >= 100 ? 56 : 48;
                const g = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: "map-group", html: `<span>${m.count}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), keyboard: true, title: `${m.count} properties here, from ${m.minPrice}. Zoom in to see them.` });
                g.on("click", () => map?.setView([m.lat, m.lng], Math.min(19, z + 2)));
                g.addTo(layer);
              } else {
                const pin = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: `map-price map-${m.purpose.toLowerCase()}`, html: `<span>₦${m.price}</span>`, iconSize: [76, 44], iconAnchor: [38, 44] }), keyboard: true, title: `${m.priceLabel}: ${m.title}, ${m.city}` });
                pin.bindPopup(pinCard(m), { maxWidth: 260, minWidth: 220 });
                pin.addTo(layer);
              }
            }
            setData(v);
            // Keep the view (and any radius) in the address, so the page can be shared or reloaded at the same place.
            const c = map.getCenter();
            const u = new URL(window.location.href);
            u.searchParams.set("lat", c.lat.toFixed(4)); u.searchParams.set("lng", c.lng.toFixed(4)); u.searchParams.set("z", String(z));
            if (near) { u.searchParams.set("near", `${near.lat.toFixed(4)},${near.lng.toFixed(4)}`); u.searchParams.set("km", String(near.km)); }
            else { u.searchParams.delete("near"); u.searchParams.delete("km"); }
            window.history.replaceState(null, "", u.toString());
          } catch {
            if (my === seq) setNote("Properties could not be loaded. Check your connection and move the map to try again.");
          } finally {
            if (my === seq) setLoading(false);
          }
        };
        if (near) {
          // Radius search: the circle stays put while the map moves; the results are everything inside it.
          const circle = L.circle([near.lat, near.lng], { radius: near.km * 1000, color: "#b45309", weight: 2, fillColor: "#fbb017", fillOpacity: 0.08, interactive: false }).addTo(map);
          L.circleMarker([near.lat, near.lng], { radius: 7, color: "#fff", weight: 3, fillColor: "#1f2125", fillOpacity: 1, interactive: false }).addTo(map);
          map.fitBounds(circle.getBounds(), { padding: [20, 20] });
        } else {
          map.on("moveend", () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 250); });
        }
        void load();
      }
      mapRef.current = map;
    })();
    return () => { alive = false; map?.remove(); mapRef.current = null; };
    // Rebuild only when the mode or the filters change; other props are the starting state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, filtersKey]);

  // Place search: built-in areas and cities with listings.
  useEffect(() => {
    if (props.mode !== "listings" && props.mode !== "pick") return;
    const t = q.trim();
    if (t.length < 2) { setPlaces([]); return; }
    const id = setTimeout(() => {
      void fetch(`/api/map/places?q=${encodeURIComponent(t)}`).then((r) => (r.ok ? r.json() : { places: [] })).then((r: { places: typeof places }) => setPlaces(r.places)).catch(() => setPlaces([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q, props.mode]);

  const goTo = (lat: number, lng: number, zoom: number) => { mapRef.current?.setView([lat, lng], zoom); setPlaces([]); };
  const locateMe = () => {
    setNote("");
    if (!("geolocation" in navigator)) { setNote("This browser cannot share your location. Search for a place instead."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => props.mode === "listings" ? setNear({ lat: p.coords.latitude, lng: p.coords.longitude, km: radius }) : goTo(p.coords.latitude, p.coords.longitude, props.mode === "pick" ? 17 : 13),
      () => setNote("Your location was not shared. Search for a place instead."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const tools = props.mode === "listings" || props.mode === "pick" ? (
    <div className="map-tools">
      <div className="map-search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to a city or area" aria-label="Go to a city or area" autoComplete="off" />
        {places.length ? (
          <ul className="map-places" aria-label="Places">
            {places.map((p) => <li key={p.label}><button type="button" onClick={() => { setQ(p.label); goTo(p.lat, p.lng, p.zoom); }}>{p.label}</button></li>)}
          </ul>
        ) : null}
      </div>
      <button type="button" className="btn" onClick={locateMe}>Near me</button>
      {props.mode === "listings" ? (
        <div className="map-radius" role="group" aria-label="Search within a distance">
          <label className="map-radius-label">Within
            <select value={radius} onChange={(e) => { const km = Number(e.target.value); setRadius(km); if (near) setNear({ ...near, km }); }}>
              {RADII_KM.map((k) => <option key={k} value={k}>{k} km</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => { const c = mapRef.current?.getCenter(); if (c) setNear({ lat: c.lat, lng: c.lng, km: radius }); }}>of the map centre</button>
          {near ? <button type="button" className="btn" onClick={() => setNear(null)}>Clear distance</button> : null}
        </div>
      ) : null}
    </div>
  ) : null;

  if (props.mode === "pick") {
    return (
      <div className="stack" style={{ gap: 8 }}>
        {tools}
        <div ref={box} className="street-map street-map-pick" />
        <input type="hidden" name="lat" value={picked ? String(picked.lat) : ""} />
        <input type="hidden" name="lng" value={picked ? String(picked.lng) : ""} />
        <p className="small muted" aria-live="polite">{picked ? `Chosen: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}. Drag the pin or tap the map to adjust.` : "Tap the map where the property is. Zoom in for accuracy."}</p>
        {note ? <p className="small">{note}</p> : null}
      </div>
    );
  }

  if (props.mode === "draw") {
    const check = corners.length >= 3 ? checkBoundary(corners) : null;
    const set = (c: [number, number][]) => { setCorners(c); drawRef.current?.redraw(c); };
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div ref={box} className="street-map street-map-pick" />
        <input type="hidden" name="boundary" value={corners.length ? JSON.stringify(corners) : ""} />
        <div className="row">
          <button type="button" className="btn" onClick={() => set(corners.slice(0, -1))} disabled={!corners.length}>Undo last corner</button>
          <button type="button" className="btn" onClick={() => set([])} disabled={!corners.length}>Start again</button>
        </div>
        <p className="small muted" aria-live="polite">
          {corners.length === 0 ? "Tap each corner of the site in order, going round it. Switch to Satellite to see the plots." : corners.length < 3 ? `${corners.length} corner${corners.length === 1 ? "" : "s"}. Add at least ${3 - corners.length} more.` : check?.ok ? `${corners.length} corners, ${areaLabel(boundaryAreaSqm(corners))}.` : check && !check.ok ? check.error : ""}
        </p>
      </div>
    );
  }

  if (props.mode !== "listings") return <div ref={box} className={`street-map${props.mode === "area" ? " street-map-small" : ""}`} />;

  const list = data?.list ?? [];
  return (
    <div className="map-layout">
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        {tools}
        <div ref={box} className="street-map street-map-tall" />
        <p className="small muted" aria-live="polite">{loading ? "Loading properties…" : data ? `${data.total.toLocaleString("en-GB")} ${data.total === 1 ? "property" : "properties"} ${near ? `within ${near.km} km, nearest first` : "in this view"}. Positions are approximate, about a kilometre.` : ""}</p>
        {note ? <p className="small">{note}</p> : null}
      </div>
      <aside className="map-list" aria-label="Properties in this view">
        <h2 className="small-h">{near ? `Within ${near.km} km` : "In this view"}</h2>
        {list.length === 0 && !loading ? <p className="small muted">No properties here yet. Zoom out or move the map.</p> : null}
        <ul className="card-list">
          {list.slice(0, 8).map((p) => <MapListItem key={p.ref} p={p} />)}
        </ul>
        {list.length > 8 ? (
          <details className="inline"><summary>Show {list.length - 8} more</summary>
            <ul className="card-list">{list.slice(8).map((p) => <MapListItem key={p.ref} p={p} />)}</ul>
          </details>
        ) : null}
        {data && data.total > list.length ? <p className="small muted">Showing the newest {list.length}. Zoom in to narrow the area.</p> : null}
      </aside>
    </div>
  );
}

function MapListItem({ p }: { p: Pin }) {
  return (
    <li>
      <a className="map-item" href={`/properties/${encodeURIComponent(p.ref)}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.photo ? <img src={`/photos/${encodeURIComponent(p.photo)}`} alt="" loading="lazy" /> : <span className="map-item-noimg" aria-hidden="true" />}
        <span className="map-item-text"><strong>{p.priceLabel}</strong><span>{p.title}</span><span className="small muted">{[p.beds !== null ? `${p.beds} bed` : "", p.city, p.distance ? `${p.distance} away` : ""].filter(Boolean).join(" · ")}</span></span>
      </a>
    </li>
  );
}
