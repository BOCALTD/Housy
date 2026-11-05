"use client";

import { useActionState } from "react";
import { CopyField } from "@/components/CopyButton";
import { shareAction, type ShareState } from "./actions";

const LABELS: Record<string, string> = { inventory: "Inventory", projects: "Improvements and project costs", valuations: "Valuations", inspections: "Field work and inspections", documents: "Documents" };

/** Make a private, read-only link for the client. Nothing is ticked for them: the agent chooses what is shared. */
export function ShareForm({ clientId, assetId, sections, email, phone }: { clientId: string; assetId: string; sections: string[]; email?: string; phone?: string }) {
  const [state, run, pending] = useActionState<ShareState, FormData>(shareAction, {});
  if (state.url) {
    const text = `Here is your private link to follow your property on Housy: ${state.url}`;
    return (
      <div className="stack" role="status">
        <p><strong>Link ready.</strong> Copy it now; for safety it is shown only once. You can close it any time.</p>
        <CopyField value={state.url} label="Client link" />
        <div className="row">
          {phone ? <a className="btn" href={`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a> : null}
          {email ? <a className="btn" href={`mailto:${email}?subject=${encodeURIComponent("Your property on Housy")}&body=${encodeURIComponent(text)}`}>Send by email</a> : null}
        </div>
      </div>
    );
  }
  return (
    <form action={run} className="stack">
      <input type="hidden" name="clientId" value={clientId} /><input type="hidden" name="assetId" value={assetId} />
      {state.error ? <p className="flash error" role="alert">{state.error}</p> : null}
      <fieldset className="field"><legend>What the client can see</legend>
        {sections.map((s) => <label key={s} className="check"><input type="checkbox" name="section" value={s} /> {LABELS[s] ?? s}</label>)}
      </fieldset>
      <p className="small muted">Correspondence and internal notes are never shared.</p>
      <label className="field">Link works for
        <select name="days" defaultValue="30"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">One year</option></select>
      </label>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Making the link…" : "Make client link"}</button>
    </form>
  );
}
