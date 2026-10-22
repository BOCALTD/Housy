"use client";
import { useEffect, useRef, useState } from "react";
import { checkInAction, emergencyAction, endSafetyAction, pingAction } from "@/app/me/inspections/actions";

/**
 * The live part of a safety session. Location is read only while this page is open and the session is on, at most once a minute,
 * and the screen always says that it is on. Closing the page stops it; pressing Check out or Stop ends the session.
 */
export function SafetyLive({ sessionId, checkedIn, emergency, numbers }: { sessionId: string; checkedIn: boolean; emergency: boolean; numbers: { label: string; number: string }[] }) {
  const [state, setState] = useState<"starting" | "on" | "denied" | "unsupported" | "ended">("starting");
  const [last, setLast] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [alerted, setAlerted] = useState(emergency);
  const sentAt = useRef(0);
  const watch = useRef<number | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) { setState("unsupported"); return; }
    watch.current = navigator.geolocation.watchPosition(async (p) => {
      setState("on");
      if (Date.now() - sentAt.current < 60_000) return;
      sentAt.current = Date.now();
      const r = await pingAction(sessionId, p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? null);
      if (r.ok) setLast(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      else { setMsg(r.error ?? "Could not share location"); if (/ended/.test(r.error ?? "")) stop(); }
    }, (e) => setState(e.code === e.PERMISSION_DENIED ? "denied" : "on"), { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 });
    return () => stop();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function stop() { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); watch.current = null; setState("ended"); }
  async function end(how: "CHECKED_OUT" | "STOPPED") { const r = await endSafetyAction(sessionId, how); if (r.ok) { stop(); setMsg(how === "CHECKED_OUT" ? "Checked out. Location sharing has stopped." : "Stopped. Location sharing has ended."); } else setMsg(r.error ?? "Could not end the session"); }
  async function sos() {
    const note = window.prompt("Emergency alert. Optional: say what is happening (or leave empty and press OK).", "") ?? null;
    if (note === null) return;
    const r = await emergencyAction(sessionId, note);
    if (r.ok) { setAlerted(true); setMsg(`Alert sent (case ${r.ref}). If you are in danger, call ${numbers[0].number} now.`); } else setMsg(r.error ?? "Could not send the alert");
  }

  return (
    <div className="stack">
      <div className={`safety-status ${state === "on" ? "on" : ""}`} role="status" aria-live="polite">
        {state === "on" ? <>Location sharing is <strong>ON</strong>{last ? ` · last shared ${last}` : " · waiting for your location"}</>
          : state === "starting" ? "Asking your phone for your location…"
          : state === "denied" ? "Your phone is not sharing location with this page. Allow location in your browser settings, or use check-in and the emergency button without it."
          : state === "unsupported" ? "This browser cannot share location. Check-in and the emergency button still work."
          : "Location sharing has stopped."}
      </div>
      {msg ? <p className="flash notice" role="alert">{msg}</p> : null}
      {state !== "ended" ? (
        <div className="row">
          {!checkedIn ? <button type="button" className="btn" onClick={async () => { const r = await checkInAction(sessionId); setMsg(r.ok ? "Checked in." : r.error ?? "Could not check in"); }}>Check in (I have arrived)</button> : null}
          <button type="button" className="btn primary" onClick={() => end("CHECKED_OUT")}>Check out: all is well</button>
          <button type="button" className="btn" onClick={() => end("STOPPED")}>Stop sharing</button>
        </div>
      ) : null}
      <button type="button" className="btn sos" onClick={sos} aria-describedby="sos-help">{alerted ? "Send another emergency alert" : "Emergency alert"}</button>
      <p id="sos-help" className="small muted">Tells the platform&apos;s safety team{" "}and, if you attend for a company, its managers, with your last location. It does not call the police: in danger, call {numbers.map((n) => `${n.number} (${n.label})`).join(" or ")}.</p>
    </div>
  );
}
