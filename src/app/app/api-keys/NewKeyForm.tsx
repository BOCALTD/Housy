"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction, type NewKeyState } from "./actions";

export function NewKeyForm({ scopes }: { scopes: { id: string; label: string }[] }) {
  const [state, run, pending] = useActionState<NewKeyState, FormData>(createApiKeyAction, {});
  const [copied, setCopied] = useState(false);
  if (state.key) {
    return (
      <div className="stack" role="status">
        <p><strong>Key “{state.name}” is ready.</strong> Copy it now. It will not be shown again; if it is lost, revoke it and make a new one.</p>
        <code className="secret-box">{state.key}</code>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => { void navigator.clipboard?.writeText(state.key!).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy key"}</button>
          <a className="btn" href="/app/api-keys">Done</a>
        </div>
      </div>
    );
  }
  return (
    <form action={run} className="stack">
      {state.error ? <p className="flash error" role="alert">{state.error}</p> : null}
      <label className="field">Name<input name="name" required maxLength={80} placeholder="For example: Accounting system" /></label>
      <fieldset className="field"><legend>What the key may do</legend>
        {scopes.map((s) => <label key={s.id} className="check"><input type="checkbox" name="scope" value={s.id} defaultChecked /> {s.label}</label>)}
      </fieldset>
      <label className="field">Lasts for
        <select name="days" defaultValue="90"><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">One year</option></select>
      </label>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Making the key…" : "Make key"}</button>
    </form>
  );
}
