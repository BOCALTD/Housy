"use client";

import { useActionState, useState } from "react";
import { CheckList } from "@/components/CheckList";
import { inviteAction, reissueAction, type InviteState } from "./actions";

function LinkBox({ state, done }: { state: InviteState; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack" role="status">
      <p><strong>Invitation for {state.who} is ready.</strong> Send them this link. It works once, for 14 days, and is not shown again.</p>
      <code className="secret-box">{state.link}</code>
      <div className="row">
        <button className="btn primary" type="button" onClick={() => { void navigator.clipboard?.writeText(state.link!).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy link"}</button>
        <a className="btn" href={done}>Done</a>
      </div>
    </div>
  );
}

export function InviteForm({ kind, assets, contractors }: { kind: "OWNER" | "VENDOR"; assets: { id: string; ref: string; name: string }[]; contractors: { id: string; name: string; trade: string; email: string }[] }) {
  const [state, run, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  if (state.link) return <LinkBox state={state} done="/app/portals" />;
  return (
    <form action={run} className="stack">
      {state.error ? <p className="flash error" role="alert">{state.error}</p> : null}
      <input type="hidden" name="kind" value={kind} />
      {kind === "VENDOR" ? (
        <label className="field">Contractor
          <select name="contractorId" required defaultValue="">
            <option value="" disabled>Choose a contractor</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.trade ? ` · ${c.trade}` : ""}</option>)}
          </select>
        </label>
      ) : null}
      <label className="field">{kind === "OWNER" ? "Owner's name" : "Contact name"}<input name="displayName" required minLength={2} maxLength={120} autoComplete="off" /></label>
      <label className="field">Their email<input name="email" type="email" required maxLength={160} autoComplete="off" /><span className="small muted">They must sign in with this email to accept.</span></label>
      {kind === "OWNER" ? (
        <fieldset className="field"><legend>Properties they may see</legend>
          {assets.length === 0 ? <p className="small muted">Add an asset first.</p> : (
            <CheckList name="assetId" noun="more properties" items={assets.map((a) => ({ id: a.id, label: a.name, hint: a.ref }))} />
          )}
        </fieldset>
      ) : null}
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Making the link…" : "Make invitation link"}</button>
    </form>
  );
}

export function ReissueForm({ id, who }: { id: string; who: string }) {
  const [state, run, pending] = useActionState<InviteState, FormData>(reissueAction, {});
  if (state.link) return <LinkBox state={state} done="/app/portals" />;
  return (
    <form action={run} className="row">
      {state.error ? <p className="flash error" role="alert">{state.error}</p> : null}
      <input type="hidden" name="id" value={id} /><input type="hidden" name="who" value={who} />
      <button className="btn" type="submit" disabled={pending}>New link</button>
    </form>
  );
}
