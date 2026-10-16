"use client";

import { useState, useTransition } from "react";
import { confirmMfaAction, type ConfirmState } from "@/app/me/security/actions";

/** Confirms the authenticator app works, then shows the recovery codes once. */
export function MfaConfirm() {
  const [state, setState] = useState<ConfirmState>({});
  const [pending, start] = useTransition();
  if (state.codes) {
    return (
      <div className="stack" role="status">
        <p><strong>Two-step sign-in is on.</strong> Save these recovery codes somewhere safe. Each works once if you lose your phone. They are shown only now.</p>
        <ul className="plain" style={{ columnWidth: 160 }}>{state.codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        <p className="small muted">Reload the page when you have saved them.</p>
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); start(async () => { setState(await confirmMfaAction(data)); }); }}>
      {state.error ? <div className="flash error" role="alert">{state.error}</div> : null}
      <label className="field">Code from the app
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" required />
      </label>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Checking…" : "Turn on two-step sign-in"}</button>
    </form>
  );
}
