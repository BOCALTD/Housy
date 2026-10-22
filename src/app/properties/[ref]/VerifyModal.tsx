"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recommendationEventAction, submitLeadAction } from "./actions";

export type ProviderView = {
  id: string; name: string; shortName: string; profile: string; services: string[];
  coverage: string; link: string; placement: "SPONSORED" | "AFFILIATED" | "EDITORIAL";
};

const LABELS = {
  SPONSORED: "Sponsored",
  AFFILIATED: "Affiliated provider",
  EDITORIAL: "Editorial recommendation",
} as const;

type Step = "choose" | "form" | "done";

export function VerifyModal({ provider, listingRef, autoOpen }: { provider: ProviderView; listingRef: string; autoOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [choice, setChoice] = useState<"yes" | "no">("yes");
  const [trigger, setTrigger] = useState("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ref: string; statusUrl: string } | null>(null);
  const [method, setMethod] = useState("phone");
  const [canSend, setCanSend] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const send = useCallback((event: "IMPRESSION" | "CONFIRMED_INTEREST" | "DECLINED" | "LATER", t = trigger) =>
    recommendationEventAction({ providerId: provider.id, listingRef, trigger: t, event }), [provider.id, listingRef, trigger]);

  const show = useCallback((t: string) => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setTrigger(t); setStep("choose"); setChoice("yes"); setError(null); setOpen(true);
    void send("IMPRESSION", t);
  }, [send]);

  useEffect(() => {
    if (autoOpen) {
      const id = window.setTimeout(() => show("view"), 900);
      return () => window.clearTimeout(id);
    }
  }, [autoOpen, show]);

  const close = useCallback((asLater: boolean) => {
    if (asLater && step === "choose") void send("LATER");
    setOpen(false);
    lastFocus.current?.focus?.();
  }, [send, step]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { close(true); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]"))
        .filter((el) => !el.hasAttribute("disabled"));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function confirmChoice() {
    if (choice === "no") {
      await send("DECLINED");
      setOpen(false);
      lastFocus.current?.focus?.();
      return;
    }
    await send("CONFIRMED_INTEREST");
    setStep("form");
  }

  async function submit(form: HTMLFormElement) {
    setBusy(true); setError(null);
    const res = await submitLeadAction(new FormData(form));
    setBusy(false);
    if (res.ok) { setResult({ ref: res.ref, statusUrl: res.statusUrl }); setStep("done"); }
    else setError(res.error);
  }

  function checkForm(form: HTMLFormElement) {
    const fd = new FormData(form);
    setCanSend(!!String(fd.get("name") ?? "").trim() && !!String(fd.get("contactValue") ?? "").trim() && fd.get("consent") === "yes");
  }

  const disclosure = provider.placement === "SPONSORED"
    ? "This provider pays for this placement."
    : provider.placement === "AFFILIATED" ? "This provider has a commercial relationship with the platform operator." : null;

  return (
    <>
      <button type="button" className="linkbtn" onClick={() => show("manual")}>Verify this property</button>
      {open ? (
        <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(true); }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="verify-title" tabIndex={-1} ref={dialogRef}>
            <button className="close" type="button" aria-label="Close" onClick={() => close(true)}>×</button>

            {step === "choose" ? (
              <>
                <p className="eyebrow">Property verification</p>
                <h2 id="verify-title">Before You Buy, Verify the Property.</h2>
                <p className="muted">Property verification and risk assessment can help you identify documentation issues, possible encumbrances, inconsistencies and other risks before you commit funds.</p>
                <div className="provider" aria-label="Approved service provider">
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <div className="provider-logo" aria-hidden="true">{provider.shortName}</div>
                    <div>
                      <strong>{provider.name}</strong>
                      <div><span className="pill disc">{LABELS[provider.placement]}</span></div>
                    </div>
                  </div>
                  {provider.profile ? <p className="small">{provider.profile}</p> : null}
                  {provider.services.length ? <ul>{provider.services.map((s) => <li key={s}>{s}</li>)}</ul> : null}
                  {provider.coverage ? <p className="small muted">Coverage: {provider.coverage}</p> : null}
                  <p className="small muted">Findings depend on the scope of checks and the records available. Verification reduces uncertainty but does not guarantee a risk-free purchase.</p>
                  {disclosure ? <p className="small muted">{disclosure} It is not independent verification, a platform guarantee, or a ranking of providers.</p> : null}
                  {provider.link ? <a href={provider.link} target="_blank" rel="noopener noreferrer" className="small">View approved profile</a> : null}
                </div>
                <fieldset style={{ border: 0, padding: 0, margin: "0 0 8px", display: "grid", gap: 8 }}>
                  <legend className="small muted" style={{ marginBottom: 6 }}>Would you like to request verification?</legend>
                  <label className="option">
                    <input type="radio" name="choice" checked={choice === "yes"} onChange={() => setChoice("yes")} />
                    <span>Yes, I&apos;m Interested</span>
                    <small>Selected for you. Nothing is sent until you continue and agree.</small>
                  </label>
                  <label className="option">
                    <input type="radio" name="choice" checked={choice === "no"} onChange={() => setChoice("no")} />
                    <span>No, Not Interested</span>
                    <small>We will not show this again for a while.</small>
                  </label>
                </fieldset>
                <p className="small muted" style={{ marginBottom: 14 }}>Opening this window shares nothing about you with any provider.</p>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="btn ghost" onClick={() => close(true)}>Maybe later</button>
                  <button type="button" className="btn primary" style={{ flex: "1 1 180px" }} onClick={confirmChoice}>
                    {choice === "no" ? "Confirm: not interested" : "Continue"}
                  </button>
                </div>
              </>
            ) : null}

            {step === "form" ? (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }} onChange={(e) => checkForm(e.currentTarget)}>
                <p className="eyebrow">Request a consultation</p>
                <h2 id="verify-title">How should {provider.shortName} reach you?</h2>
                <p className="muted small">Property reference <span className="mono">{listingRef}</span>. Share only what is needed for a callback.</p>
                <input type="hidden" name="providerId" value={provider.id} />
                <input type="hidden" name="listingRef" value={listingRef} />
                <label className="field">Full name<input name="name" autoComplete="name" required /></label>
                <label className="field">Preferred contact
                  <select name="contactMethod" value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="phone">Phone call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
                  </select>
                </label>
                <label className="field">{method === "email" ? "Email address" : method === "whatsapp" ? "WhatsApp number" : "Phone number"}
                  <input name="contactValue" type={method === "email" ? "email" : "tel"} required autoComplete="off" />
                </label>
                <label className="field">Note for the provider (optional)<textarea name="note" rows={2} /></label>
                <div className="share-box">
                  <strong>What will be shared with {provider.shortName}</strong>
                  <ul><li>Your name and the contact detail above</li><li>Property reference {listingRef}</li><li>Your note, if you add one</li></ul>
                </div>
                <label className="check">
                  <input type="checkbox" name="consent" value="yes" />
                  <span>I agree to share these details with {provider.name} so they can contact me about property verification.</span>
                </label>
                <p className="small muted">Any fee is agreed with the provider before work starts. Sending this request is not an order and does not authorise payment.</p>
                {error ? <div className="flash error" role="alert">{error}</div> : null}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="btn ghost" onClick={() => setStep("choose")}>Back</button>
                  <button type="submit" className="btn primary" disabled={!canSend || busy}>{busy ? "Sending…" : "Send request"}</button>
                </div>
              </form>
            ) : null}

            {step === "done" && result ? (
              <div className="stack">
                <p className="eyebrow">Request received</p>
                <h2 id="verify-title">{provider.shortName} will be in touch.</h2>
                <p className="mono" style={{ fontSize: 20, color: "var(--primary-text)" }}>{result.ref}</p>
                <p className="muted">Keep this reference. The provider will contact you and explain the scope and any fee before anything starts.</p>
                <p className="small">Track or withdraw your request at your private status page. Bookmark it, because it is only shown now.</p>
                <div className="row">
                  <a className="btn" href={result.statusUrl}>Open status page</a>
                  <button type="button" className="btn primary" onClick={() => close(false)}>Done</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
