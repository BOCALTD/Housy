"use client";

import { useEffect, useRef, useState } from "react";

type Mode =
  /** Put the code in this input and send its form (open the item). */
  | { fill: string }
  /** Move to the field marked data-scan-code="<code>" (a count sheet line). */
  | { focus: true };

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

const WANTED = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "data_matrix"];

/** A label's QR code holds the scan address; take the code out of it. Anything else is the code itself. */
export function codeFromScan(raw: string): string {
  const v = raw.trim();
  try {
    const u = new URL(v);
    const c = u.searchParams.get("code");
    if (c && u.pathname.endsWith("/scan")) return c;
  } catch { /* not an address */ }
  return v;
}

/**
 * Scan a label with the device camera. Uses the browser's own barcode reader where there is one (Chrome on Android, for
 * example) and a built-in reader elsewhere (iPhone, desktop browsers). Nothing leaves the device: the picture is read here.
 */
export function CameraScan({ mode, label = "Scan with camera" }: { mode: Mode; label?: string }) {
  const box = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stop = useRef<() => void>(() => undefined);
  const [state, setState] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [message, setMessage] = useState("");
  const [supported, setSupported] = useState(true);

  useEffect(() => { setSupported(!!navigator.mediaDevices?.getUserMedia); return () => stop.current(); }, []);

  const close = () => { stop.current(); stop.current = () => undefined; setState("idle"); box.current?.close(); };

  const found = (raw: string) => {
    const code = codeFromScan(raw);
    if (!code) return false;
    if ("fill" in mode) {
      const input = document.getElementById(mode.fill) as HTMLInputElement | null;
      if (!input) return false;
      close();
      input.value = code;
      input.form?.requestSubmit();
      return true;
    }
    const target = Array.from(document.querySelectorAll<HTMLInputElement>("[data-scan-code]")).find((el) => (el.dataset.scanCode ?? "").toLowerCase() === code.toLowerCase());
    if (!target) { setMessage(`"${code}" is not on this list. Scan another label.`); return false; }
    close();
    // A long list keeps later rows folded away: unfold the one holding this line.
    let fold = target.closest("details");
    while (fold) { fold.open = true; fold = fold.parentElement?.closest("details") ?? null; }
    target.scrollIntoView({ block: "center" });
    target.focus();
    target.select?.();
    return true;
  };

  const start = async () => {
    setMessage("");
    setState("starting");
    box.current?.showModal();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
      setState("error");
      const name = (e as { name?: string }).name;
      setMessage(name === "NotAllowedError" ? "The camera is blocked for this site. Allow the camera in your browser's site settings, then try again." : name === "NotFoundError" ? "No camera was found on this device. Type the code instead." : "The camera could not start. Close other apps using it and try again, or type the code.");
      return;
    }
    const v = video.current!;
    v.srcObject = stream;
    await v.play().catch(() => undefined);
    let live = true;
    const tracks = () => stream.getTracks().forEach((t) => t.stop());
    stop.current = () => { live = false; tracks(); v.srcObject = null; };
    setState("scanning");

    const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const formats = Native ? ((await Native.getSupportedFormats?.().catch(() => [])) ?? []).filter((f) => WANTED.includes(f)) : [];
    if (Native && formats.includes("qr_code")) {
      const det = new Native({ formats });
      const tick = async () => {
        if (!live) return;
        try {
          const r = await det.detect(v);
          if (r[0]?.rawValue && found(r[0].rawValue)) return;
        } catch { /* frame not ready */ }
        setTimeout(tick, 180);
      };
      tick();
      return;
    }
    // No reader in the browser: the built-in one, loaded only when needed.
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    if (!live) return;
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
    const controls = await reader.decodeFromVideoElement(v, (result) => {
      if (live && result) found(result.getText());
    }).catch(() => null);
    if (!controls) { if (live) { setState("error"); setMessage("The camera picture could not be read. Type the code instead."); } return; }
    if (!live) { controls.stop(); return; }
    const prev = stop.current;
    stop.current = () => { controls.stop(); prev(); };
  };

  if (!supported) return null;
  return (
    <>
      <button type="button" className="btn" onClick={start} aria-haspopup="dialog">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8" /></svg>
        <span>{label}</span>
      </button>
      <dialog ref={box} className="cfm scan-box" aria-labelledby="scan-title" onCancel={(e) => { e.preventDefault(); close(); }}>
        <div className="cfm-inner">
          <h2 id="scan-title">Scan a label</h2>
          <p>Point the camera at the QR code or barcode on the label.</p>
          <div className="scan-view">
            <video ref={video} playsInline muted aria-label="Camera view" />
            {state === "scanning" ? <span className="scan-frame" aria-hidden="true" /> : null}
            {state === "starting" ? <span className="scan-wait">Starting the camera…</span> : null}
          </div>
          {message ? <p role="alert" className="small">{message}</p> : null}
          <div className="cfm-actions">
            <button type="button" className="btn" onClick={close}>Close</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
