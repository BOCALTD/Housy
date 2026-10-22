"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";

/**
 * A real street map (OpenStreetMap tiles by default, or the provider set in NEXT_PUBLIC_MAP_TILES).
 * Modes:
 *  - "listings": published properties in the visible area, loaded as the map moves, with a list beside it;
 *  - "points": a fixed set of markers (a company's portfolio, vacancy areas);
 *  - "pick": one draggable pin to choose a position, written to hidden form fields;
 *  - "area": a shaded circle around one listing's approximate area.
 * The page never depends on the map: lists and forms carry the same information as text.
 */

const TILES = process.env.NEXT_PUBLIC_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors";

export type View = { lat: number; lng: number; zoom: number };
type Pin = { kind: "pin"; ref: string; lat: number; lng: number; price: string; title: string; priceLabel: string; beds: number | null; city: string; purpose: string; photo: string | null };
type Group = { kind: "group"; lat: number; lng: number; count: number; minPrice: string };
type ViewData = { total: number; markers: (Pin | Group)[]; list: Pin[] };
export type StaticPoint = { id: string; lat: number; lng: number; label: string; href?: string; group?: string; weight?: number; approximate?: boolean };

const COLOURS: Record<string, string> = { SALE: "#0f766e", RENT: "#1d4ed8", LEASE: "#7c3aed", OCCUPIED: "#0f766e", VACANT: "#b45309", ACTIVE: "#1d4ed8", UNDER_RENOVATION: "#7c3aed", VACANCY: "#b45309" };

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
  L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, subdomains: "abc", crossOrigin: true }).addTo(map);
  map.setView([view.lat, view.lng], view.zoom);
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

export function StreetMap(props:
  | { mode: "listings"; start: View; filters: Record<string, string>; label?: string }
  | { mode: "points"; points: StaticPoint[]; start: View; label?: string }
  | { mode: "pick"; start: View; value: { lat: number; lng: number } | null; label?: string }
  | { mode: "area"; centre: { lat: number; lng: number }; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const [data, setData] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(props.mode === "pick" ? props.value : null);
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<{ label: string; lat: number; lng: number; zoom: number }[]>([]);
  const [note, setNote] = useState("");
  const filtersKey = props.mode === "listings" ? JSON.stringify(props.filters) : "";

  useEffect(() => {
    let alive = true;
    let map: Leaflet.Map | null = null;
    void (async () => {
      const L = await loadLeaflet();
      if (!alive || !box.current) return;
      const label = props.label ?? "Map";
      if (props.mode === "area") {
        map = makeMap(L, box.current, { ...props.centre, zoom: 14 }, label);
        L.circle([props.centre.lat, props.centre.lng], { radius: 700, color: "#b7791f", weight: 2, fillColor: "#fbb017", fillOpacity: 0.25 }).addTo(map);
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
          if (p.approximate) card.appendChild(text("span", "map-card-meta", "Approximate position (area centre)"));
          m.bindPopup(card, { maxWidth: 260 });
          m.addTo(layer);
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
          const params = new URLSearchParams({ ...props.filters, bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(","), zoom: String(z) });
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
            // Keep the view in the address, so the page can be shared or reloaded at the same place.
            const c = map.getCenter();
            const u = new URL(window.location.href);
            u.searchParams.set("lat", c.lat.toFixed(4)); u.searchParams.set("lng", c.lng.toFixed(4)); u.searchParams.set("z", String(z));
            window.history.replaceState(null, "", u.toString());
          } catch {
            if (my === seq) setNote("Properties could not be loaded. Check your connection and move the map to try again.");
          } finally {
            if (my === seq) setLoading(false);
          }
        };
        map.on("moveend", () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 250); });
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
      (p) => goTo(p.coords.latitude, p.coords.longitude, props.mode === "pick" ? 17 : 13),
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

  if (props.mode !== "listings") return <div ref={box} className={`street-map${props.mode === "area" ? " street-map-small" : ""}`} />;

  const list = data?.list ?? [];
  return (
    <div className="map-layout">
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        {tools}
        <div ref={box} className="street-map street-map-tall" />
        <p className="small muted" aria-live="polite">{loading ? "Loading properties…" : data ? `${data.total.toLocaleString("en-GB")} ${data.total === 1 ? "property" : "properties"} in this view. Positions are approximate, about a kilometre.` : ""}</p>
        {note ? <p className="small">{note}</p> : null}
      </div>
      <aside className="map-list" aria-label="Properties in this view">
        <h2 className="small-h">In this view</h2>
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
        <span className="map-item-text"><strong>{p.priceLabel}</strong><span>{p.title}</span><span className="small muted">{[p.beds !== null ? `${p.beds} bed` : "", p.city].filter(Boolean).join(" · ")}</span></span>
      </a>
    </li>
  );
}
