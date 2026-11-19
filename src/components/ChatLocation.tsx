"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

// The map loads only when a location is shown or chosen.
const StreetMap = dynamic(() => import("./StreetMap").then((m) => m.StreetMap), { ssr: false, loading: () => <div className="chat-map-wait">Loading the map…</div> });

type Loc = { lat: number; lng: number; label?: string; accuracyM?: number | null; source: "device" | "map" };

const pinIcon = <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;

/** A location in a chat bubble: the place on a small map, its label, and a link to open it in the phone's maps app. */
export function LocationBubble({ lat, lng, label, accuracyM, source }: { lat: number; lng: number; label: string; accuracyM: number | null; source: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="bubble-loc">
      {show ? <div className="chat-map"><StreetMap mode="area" centre={{ lat, lng }} exact label={label || "Shared location"} /></div> : (
        <button type="button" className="chat-map-tap" onClick={() => setShow(true)} aria-label="Show the location on a map">{pinIcon}<span>Show on map</span></button>
      )}
      <strong className="bubble-loc-label">📍 {label || (source === "device" ? "Current location" : "Location")}</strong>
      <span className="bubble-file-meta">{lat.toFixed(5)}, {lng.toFixed(5)}{accuracyM ? ` · within about ${accuracyM < 1000 ? `${accuracyM} m` : `${(accuracyM / 1000).toFixed(1)} km`}` : ""}</span>
      <a className="btn small" href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noopener">Open in maps</a>
    </div>
  );
}

/**
 * The composer's location button: share where you are now (your device asks first) or choose a place on the map, add a label if
 * you like, then confirm. Nothing is sent until you press Send.
 */
export function LocationShare({ onSend, start }: { onSend: (loc: Loc) => Promise<void>; start: { lat: number; lng: number } }) {
  const box = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"choose" | "map">("choose");
  const [here, setHere] = useState<Loc | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  // The button sits inside the chat's composer form; the dialog has a form of its own, so it is placed at the end of the page
  // (forms cannot be nested) once the page is running in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const open = () => { setMode("choose"); setHere(null); setLabel(""); box.current?.showModal(); };
  const close = () => box.current?.close();

  const locate = () => {
    if (!navigator.geolocation) { toast.error("This device cannot share its location. Choose the place on the map instead."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); setHere({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, source: "device" }); },
      (e) => { setBusy(false); toast.error(e.code === 1 ? "Location is blocked for this site. Allow it in your browser's settings, or choose the place on the map." : "Your location could not be found. Try again outside, or choose the place on the map."); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const send = async () => {
    let loc = here;
    if (mode === "map") {
      const f = new FormData(form.current!);
      const lat = Number(f.get("lat")), lng = Number(f.get("lng"));
      if (!f.get("lat") || !Number.isFinite(lat)) { toast.error("Tap the map to place the pin first."); return; }
      loc = { lat, lng, source: "map" };
    }
    if (!loc) return;
    setBusy(true);
    await onSend({ ...loc, label: label.trim() });
    setBusy(false);
    close();
  };

  return (
    <>
      <button type="button" className="composer-btn" aria-label="Share a location" aria-haspopup="dialog" onClick={open}>{pinIcon}</button>
      {mounted ? createPortal(<dialog ref={box} className="cfm loc-box" aria-labelledby="loc-title" onCancel={(e) => { e.preventDefault(); close(); }}>
        <form ref={form} className="cfm-inner" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void send(); }}>
          <h2 id="loc-title">Share a location</h2>
          {mode === "choose" && !here ? (
            <div className="stack" style={{ gap: 8 }}>
              <button type="button" className="btn primary" onClick={locate} disabled={busy}>{busy ? "Finding you…" : "Where I am now"}</button>
              <button type="button" className="btn" onClick={() => setMode("map")}>Choose a place on the map</button>
              <p className="small muted">Your device asks before it shares where you are. Only the people in this chat see it.</p>
            </div>
          ) : null}
          {mode === "choose" && here ? <p>Found you{here.accuracyM ? `, to within about ${Math.round(here.accuracyM)} m` : ""}.</p> : null}
          {mode === "map" ? <div className="chat-map pick"><StreetMap mode="pick" start={{ ...start, zoom: 12 }} value={null} label="Tap to place the pin" /></div> : null}
          {here || mode === "map" ? (
            <>
              <label className="field"><span>Label (optional)</span><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Gate 2, by the pharmacy" /></label>
              <p className="small muted">This location goes to everyone in this chat.</p>
              <div className="cfm-actions">
                <button type="button" className="btn" onClick={close}>Cancel</button>
                <button type="submit" className="btn primary" disabled={busy}>Send location</button>
              </div>
            </>
          ) : <div className="cfm-actions"><button type="button" className="btn" onClick={close}>Cancel</button></div>}
        </form>
      </dialog>, document.body) : null}
    </>
  );
}
