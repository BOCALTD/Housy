"use client";

import { useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/components/Confirm";
import { SessionSwitch } from "@/components/SessionSwitch";
import ShareButton from "@/components/ShareButton";

// Long words and addresses are what break narrow screens, so every sample has one.
const LONG = "Your payment of ₦2,450,000 for the three-bedroom terrace at 14 Admiralty Way, Lekki Phase 1 was received. A receipt went to accounts-receivable.department@lekkihomesandproperties.example.ng and the agent has been told.";

export function QaStates() {
  const [veil, setVeil] = useState(false);
  const [sw, setSw] = useState(false);
  return (
    <>
      <section className="card stack" data-qa="messages">
        <h2>Messages on a page</h2>
        <div className="flash notice" data-qa="flash-notice">Saved. {LONG}</div>
        <div className="flash error" data-qa="flash-error">That did not work. Check the amount and try again. {LONG}</div>
        <div className="flash warn" data-qa="flash-warn">This listing has not been confirmed for 45 days. {LONG}</div>
        <div className="flash" data-qa="flash-plain">Note: {LONG}</div>
        <label className="field">Email<input type="email" defaultValue="not-an-email" aria-invalid="true" /><small className="field-error" data-qa="field-error">Enter an email address like name@example.com.</small></label>
      </section>
      <section className="card art-empty" data-qa="empty">
        <div className="art-empty-ico" aria-hidden="true">🏠</div><h2>No properties in this file yet</h2>
        <p className="muted">Add a property above. Properties from this client&apos;s deals are added on their own.</p>
      </section>
      <section className="card stack" data-qa="open">
        <h2>Windows and pop-up messages</h2>
        <div className="row wrap">
          <button className="btn" data-qa="toast-success" onClick={() => toast.success("Saved", { description: LONG })}>Success message</button>
          <button className="btn" data-qa="toast-error" onClick={() => toast.error("That did not work. Check your connection and try again.")}>Error message</button>
          <button className="btn" data-qa="toast-warning" onClick={() => toast.warning("Your plan ends in 3 days", { description: LONG })}>Warning message</button>
          <button className="btn" data-qa="toast-info" onClick={() => toast.info("Link copied")}>Info message</button>
          <button className="btn" data-qa="confirm-danger" onClick={() => void confirmAction({ title: "Delete this campaign for good?", body: LONG, ok: "Delete campaign" })}>Confirm (remove)</button>
          <button className="btn" data-qa="confirm-default" onClick={() => void confirmAction({ title: "Sign out every other device?", body: "Phones and computers signed in to this account will have to sign in again.", ok: "Sign out other devices", tone: "default" })}>Confirm (other)</button>
          <button className="btn" data-qa="switch" onClick={() => setSw(true)}>Account switch</button>
          <button className="btn" data-qa="veil" onClick={() => { setVeil(true); setTimeout(() => setVeil(false), 4000); }}>Working…</button>
          <button className="btn" data-qa="health" onClick={() => (window as unknown as { __housyHealth?: (t: string) => void }).__housyHealth?.("Parts of this page did not load, so some buttons and menus may not work. Reload the page. If it keeps happening, try a private window or turn off ad blockers for Housy.")}>Page problem bar</button>
          <span data-qa="share"><ShareButton kind="property" path="/properties" title="Three-bedroom terrace, Lekki Phase 1" text={LONG} photos={[]} signedIn={false} /></span>
        </div>
      </section>
      {sw ? <SessionSwitch name="Adaeze Okonkwo-Bamidele" role="Company Super Admin at Lekki Homes and Properties Limited" goingTo="the staff sign-in" stayHref="/qa/states" then="/qa/states" /> : null}
      {veil ? <div className="switch-veil" role="status" data-qa="veil-box"><div className="cfm-inner"><ol className="switch-steps"><li className="now"><span className="switch-dot" aria-hidden="true" />Signing you in to the staff area…</li></ol></div></div> : null}
    </>
  );
}
