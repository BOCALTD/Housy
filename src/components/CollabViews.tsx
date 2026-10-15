import Link from "next/link";
import SaveDocument from "@/components/SaveDocument";
import { EnumOptions, Field, Pill, ShowMore } from "@/components/ui";
import { COMPANY_PURPOSES, SEEKER_PURPOSES } from "@/lib/collab-rules";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import type { getWorkspace, listCollaborations, ListedCollab } from "@/lib/services/collab";
import {
  commentAction, addParticipantAction, addTaskAction, cancelAction, createInvitationAction, endAction, refreshItemAction, respondAction, resumeAction, revokeItemAction, revokeParticipantAction,
  sendAction, shareDealAction, shareDocumentAction, shareNoteAction, sharePropertyAction, suspendAction, taskStatusAction, updateParticipantAction,
} from "@/app/collaborations/actions";

type Listing = Awaited<ReturnType<typeof listCollaborations>>;
type Workspace = Awaited<ReturnType<typeof getWorkspace>>;
const when = (d: Date | null | undefined) => (d ? formatDate(d) : "");
const dt = (d: Date) => `${formatDate(d)} ${d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}`;

function Row({ r, base }: { r: ListedCollab; base: string }) {
  return (
    <li key={r.c.id}><div className="row between" style={{ width: "100%" }}>
      <div><Link href={`${base}/${r.c.id}`}><strong>{r.c.title}</strong></Link>
        <div className="small muted">{r.c.ref} · {humanize(r.c.purpose)} · with {r.otherName}{r.c.expiresAt && r.c.status === "PENDING" ? ` · answer by ${when(r.c.expiresAt)}` : ""}</div></div>
      <Pill status={r.needsAnswer ? "PENDING" : r.c.status} label={r.needsAnswer ? "Needs your answer" : humanize(r.c.status)} />
    </div></li>
  );
}

export function CollabList({ data, base, newHref }: { data: Listing; base: string; newHref?: string }) {
  const block = (title: string, rows: ListedCollab[], empty: string) => (
    <section className="card"><h2>{title}</h2>{rows.length === 0 ? <p className="muted">{empty}</p> : <ShowMore noun="more" limit={5} items={rows.map((r) => <Row key={r.c.id} r={r} base={base} />)} />}</section>
  );
  return (
    <>
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{data.toAnswer.length}</b><span>Waiting for your answer</span></div>
        <div className="stat"><b>{data.active.length}</b><span>Open workspaces</span></div>
        <div className="stat"><b>{data.sent.length}</b><span>Invitations out</span></div>
      </section>
      {newHref ? <div><Link className="btn primary" href={newHref}>New invitation</Link></div> : null}
      {block("Waiting for your answer", data.toAnswer, "No invitations are waiting.")}
      {block("Open workspaces", data.active, "No open workspaces.")}
      {block("Invitations you sent", data.sent, "Nothing is waiting for an answer.")}
      {block("Finished", data.closed, "Nothing finished yet.")}
    </>
  );
}

export function CollabNewForm({ kind, agent, company, targetName, hasCompany }: { kind: "SEEKER_AGENT" | "COMPANY_COMPANY"; agent?: string; company?: string; targetName: string; hasCompany: boolean }) {
  const purposes = kind === "SEEKER_AGENT" ? SEEKER_PURPOSES : COMPANY_PURPOSES;
  return (
    <form action={createInvitationAction} className="card stack">
      <h2>Invite {targetName}</h2>
      <p className="small muted">{kind === "SEEKER_AGENT" ? "The agent chooses whether to accept. Nothing about you is shared until they do, and you choose what you share afterwards." : "The other company chooses whether to accept. Neither company sees the other's records. You each share only what you choose, as a copy."}</p>
      <input type="hidden" name="kind" value={kind} />
      {agent ? <input type="hidden" name="agentUserId" value={agent} /> : null}
      {company ? <input type="hidden" name="companyId" value={company} /> : null}
      <div className="fields">
        <Field label="Purpose"><select name="purpose" defaultValue={purposes[0]}><EnumOptions values={purposes} /></select></Field>
        <Field label="Title"><input name="title" required maxLength={160} /></Field>
        <Field label="End date" hint="Optional. The workspace closes by itself on this day."><input name="endsOn" type="date" /></Field>
      </div>
      <Field label="What you want to do together"><textarea name="scope" rows={3} maxLength={2000} /></Field>
      <Field label="Terms" hint="For example how a fee would be shared. This is a note for both of you; it does not move money."><textarea name="terms" rows={2} maxLength={2000} /></Field>
      {!hasCompany && kind === "COMPANY_COMPANY" ? <p className="small muted">Sign in to your company workspace to invite a company.</p> : null}
      <div className="row"><button className="btn primary" type="submit" name="intent" value="send">Send invitation</button><button className="btn" type="submit" name="intent" value="draft">Save as draft</button></div>
    </form>
  );
}

const PermBoxes = ({ p }: { p?: { canComment: boolean; canTasks: boolean; canShare: boolean; canDocuments: boolean } }) => (
  <div className="row">
    <label><input type="checkbox" name="canComment" defaultChecked={p?.canComment ?? true} /> Comment</label>
    <label><input type="checkbox" name="canTasks" defaultChecked={p?.canTasks ?? true} /> Tasks</label>
    <label><input type="checkbox" name="canShare" defaultChecked={p?.canShare ?? true} /> Share</label>
    <label><input type="checkbox" name="canDocuments" defaultChecked={p?.canDocuments ?? true} /> Documents</label>
  </div>
);

export interface WorkspaceExtras { colleagues: { userId: string; name: string }[]; deals: { id: string; ref: string; title: string }[]; assets: { id: string; ref: string; name: string }[]; isPlatform?: boolean }

export function CollabWorkspaceView({ w, extras, base }: { w: Workspace; extras: WorkspaceExtras; base: string }) {
  const { collab: c } = w;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const id = hidden("id", c.id);
  const open = c.status === "ACTIVE";
  const canSender = w.speaks.sender, canRecipient = w.speaks.recipient;
  const mySideSpeaks = w.side === "SENDER" ? canSender : w.side === "RECIPIENT" ? canRecipient : false;
  const company = c.kind === "COMPANY_COMPANY";
  const suspendedByMe = c.status === "SUSPENDED" && c.suspendedBy && c.suspendedBy !== "PLATFORM" && (c.suspendedBy === "SENDER" ? canSender : canRecipient);
  const taken = new Set(w.participants.filter((p) => !p.revokedAt).map((p) => p.userId));

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <div className="row between"><h1>{c.title}</h1><Pill status={c.status} label={humanize(c.status)} /></div>
        <p className="muted">{c.ref} · {humanize(c.purpose)} · {c.senderName} and {c.recipientName}{c.endsOn ? ` · ends ${when(c.endsOn)}` : ""}</p>
        {c.scope || c.terms ? (
          <details className="inline"><summary>What this is for, and the terms</summary>
            {c.scope ? <p>{c.scope}</p> : null}{c.terms ? <p className="small muted">Terms: {c.terms}</p> : null}</details>
        ) : null}
      </div>

      {w.plan.access !== "FULL" ? <div className="flash error" role="status">{w.plan.explanation} {w.mode.reason}</div> : null}
      {c.status === "SUSPENDED" ? <div className="flash error" role="status">Suspended{c.suspendedBy === "PLATFORM" ? " by the platform" : ""}: {c.suspendReason}</div> : null}

      {w.mayAnswer ? (
        <section className="card stack"><h2>Your answer</h2>
          <form action={respondAction} className="stack">{id}
            <Field label="A note to them (optional)"><input name="note" maxLength={500} /></Field>
            {company ? (
              <fieldset><legend className="small muted">Who will work on this for your company (you are included if you choose no one)</legend>
                <div className="row">{extras.colleagues.map((m) => <label key={m.userId}><input type="checkbox" name="person" value={m.userId} /> {m.name}</label>)}</div></fieldset>
            ) : null}
            <div className="row"><button className="btn primary" type="submit" name="decision" value="accept">Accept</button><button className="btn" type="submit" name="decision" value="decline">Decline</button></div>
          </form></section>
      ) : null}

      {(c.status === "DRAFT" || c.status === "PENDING") && w.speaks.sender ? (
        <section className="card stack"><h2>Your invitation</h2>
          <p className="small muted">{c.status === "DRAFT" ? "Not sent yet." : `Sent ${when(c.sentAt)}. It expires ${when(c.expiresAt)} if nobody answers.`}</p>
          <div className="row">
            {c.status === "DRAFT" ? <form action={sendAction}>{id}<button className="btn primary" type="submit">Send invitation</button></form> : null}
            <details className="inline"><summary>Cancel the invitation</summary>
              <form action={cancelAction} className="stack">{id}<Field label="Reason (optional)"><input name="reason" maxLength={500} /></Field><button className="btn" type="submit">Cancel invitation</button></form></details>
          </div></section>
      ) : null}

      {c.status === "DECLINED" && c.responseNote ? <p className="small muted">Their note: {c.responseNote}</p> : null}

      {w.contentHidden && ["ACTIVE", "SUSPENDED", "COMPLETED"].includes(c.status) ? (
        <section className="card"><h2>Workspace</h2><p className="muted">{w.me ? (w.mode.reason || w.plan.explanation) : "You can see who is involved and the history, but the shared content is only for the people given access."}</p></section>
      ) : null}

      {!w.contentHidden ? (
        <>
          <section className="card stack"><h2>Shared by both sides</h2>
            <p className="small muted">Each item is a copy of what its owner chose to show. The owner can update it or take it back at any time.</p>
            {w.items.length === 0 ? <p className="muted">Nothing shared yet.</p> : (
              <ShowMore noun="more items" limit={4} items={w.items.map((i) => {
                const mine = w.side === i.side;
                const f = ((i.details as { fields?: { label: string; value: string }[] } | null)?.fields ?? []);
                return (
                  <li key={i.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
                    <div className="row between"><div><strong>{i.title}</strong> <span className="small muted">{humanize(i.kind)} · {mine ? "yours" : `from ${i.sharedByName}`} · {when(i.createdAt)}{i.version > 1 ? ` · updated ${i.version - 1}×` : ""}</span></div>{i.revokedAt ? <Pill status="REVOKED" label="Taken back" /> : null}</div>
                    {i.revokedAt ? <p className="small muted">Taken back {when(i.revokedAt)}: {i.revokeReason}</p> : (
                      <>
                        {i.summary ? <p className="small">{i.summary}</p> : null}
                        {f.length ? <details className="inline"><summary>Details</summary><ul className="timeline">{f.map((x, n) => <li key={n}>{x.label}: {x.value}</li>)}</ul></details> : null}
                        {i.fileKey ? <SaveDocument url={`/collaborations/file/${i.id}`} fallbackName={i.fileName ?? "document"} /> : null}
                        {mine && w.canWrite ? (
                          <details className="inline"><summary>Update or take back</summary>
                            <div className="row">
                              {i.sourceType === "deal" || i.kind === "PROPERTY" ? <form action={refreshItemAction}>{id}{hidden("itemId", i.id)}<button className="btn" type="submit">Update the copy</button></form> : null}
                              <form action={revokeItemAction} className="row">{id}{hidden("itemId", i.id)}<input name="reason" placeholder="Why" required minLength={3} aria-label="Why" /><button className="btn" type="submit">Take back</button></form>
                            </div></details>
                        ) : null}
                      </>
                    )}
                  </div></li>
                );
              })} />
            )}
            {w.canWrite && w.can.share ? (
              <details className="inline"><summary>Share a property</summary>
                <form action={sharePropertyAction} className="stack">{id}
                  {extras.assets.length ? <Field label="One of your properties"><select name="assetId" defaultValue=""><option value="">Choose…</option>{extras.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} {a.name}</option>)}</select></Field> : null}
                  <Field label="Or a published listing's reference"><input name="listingRef" placeholder="Listing reference" /></Field>
                  <div className="row"><label><input type="checkbox" name="price" defaultChecked /> Show the price</label><label><input type="checkbox" name="address" /> Show the street address</label></div>
                  <Field label="Note"><input name="note" maxLength={500} /></Field>
                  <button className="btn" type="submit">Share property</button></form></details>
            ) : null}
            {w.canWrite && w.can.share && company && extras.deals.length ? (
              <details className="inline"><summary>Share a deal summary</summary>
                <form action={shareDealAction} className="stack">{id}
                  <p className="small muted">Pick only what the other company needs. The client, the notes and the rest of the deal stay with you.</p>
                  <Field label="Deal"><select name="dealId" required defaultValue="">{<option value="">Choose…</option>}{extras.deals.map((d) => <option key={d.id} value={d.id}>{d.ref} {d.title}</option>)}</select></Field>
                  <div className="row"><label><input type="checkbox" name="stage" /> Stage</label><label><input type="checkbox" name="asking" /> Asking price</label><label><input type="checkbox" name="agreed" /> Agreed price</label><label><input type="checkbox" name="expectedClose" /> Expected close</label><label><input type="checkbox" name="propertyAddress" /> Street address</label></div>
                  <Field label="Note"><input name="note" maxLength={500} /></Field>
                  <button className="btn" type="submit">Share deal summary</button></form></details>
            ) : null}
            {w.canWrite && w.can.share ? (
              <details className="inline"><summary>Share a note</summary>
                <form action={shareNoteAction} className="stack">{id}<Field label="Title"><input name="title" required /></Field><Field label="Note"><textarea name="body" rows={3} required /></Field><button className="btn" type="submit">Share note</button></form></details>
            ) : null}
            {w.canWrite && w.can.documents ? (
              <details className="inline"><summary>Share a document</summary>
                <form action={shareDocumentAction} className="stack">{id}<Field label="Title"><input name="title" required /></Field><Field label="File" hint="PDF, image or Word file."><input type="file" name="file" required /></Field><button className="btn" type="submit">Share document</button></form></details>
            ) : null}
          </section>

          <section className="card stack"><h2>Tasks and milestones</h2>
            {w.tasks.length === 0 ? <p className="muted">None yet.</p> : (
              <ShowMore noun="more" limit={5} items={w.tasks.map((t) => (
                <li key={t.id}><div className="row between" style={{ width: "100%" }}>
                  <div><strong>{t.milestone ? "Milestone: " : ""}{t.title}</strong><div className="small muted">{t.assigneeName ? `${t.assigneeName} · ` : ""}{t.dueOn ? `due ${when(t.dueOn)} · ` : ""}{humanize(t.status)}{t.outcome ? ` · ${t.outcome}` : ""}</div></div>
                  {w.canWrite && w.can.tasks && t.status === "OPEN" ? (
                    <form action={taskStatusAction} className="row">{id}{hidden("taskId", t.id)}<input name="outcome" placeholder="What was done" aria-label="What was done" /><button className="btn" type="submit" name="status" value="DONE">Done</button></form>
                  ) : null}
                </div></li>))} />
            )}
            {w.canWrite && w.can.tasks ? (
              <details className="inline"><summary>Add a task or milestone</summary>
                <form action={addTaskAction} className="stack">{id}
                  <div className="fields"><Field label="Title"><input name="title" required /></Field><Field label="Due"><input name="dueOn" type="date" /></Field>
                    <Field label="Assign to"><select name="assigneeId" defaultValue=""><option value="">Anyone</option>{w.participants.filter((p) => !p.revokedAt).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</select></Field></div>
                  <Field label="Details"><input name="description" maxLength={2000} /></Field>
                  <label><input type="checkbox" name="milestone" /> This is a milestone</label>
                  <button className="btn" type="submit">Add</button></form></details>
            ) : null}
          </section>

          <section className="card stack"><h2>Comments</h2>
            {w.comments.length === 0 ? <p className="muted">No comments yet.</p> : (
              <ShowMore noun="more comments" limit={5} items={w.comments.map((m) => <li key={m.id}><div><strong>{m.authorName}</strong> <span className="small muted">{dt(m.createdAt)}</span><div>{m.body}</div></div></li>)} />
            )}
            {w.canWrite && w.can.comment ? <form action={commentAction} className="row">{id}<input name="body" required placeholder="Write a comment" aria-label="Comment" style={{ flex: 1 }} /><button className="btn" type="submit">Send</button></form> : null}
          </section>
        </>
      ) : null}

      <section className="card stack"><h2>People with access</h2>
        <ShowMore noun="more people" limit={5} items={w.participants.map((p) => (
          <li key={p.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
            <div className="row between"><div><strong>{p.name}</strong> <span className="small muted">{p.side === "SENDER" ? c.senderName : c.recipientName}{p.expiresAt && !p.revokedAt ? ` · access ends ${when(p.expiresAt)}` : ""}</span></div>
              {p.revokedAt ? <Pill status="REVOKED" label="Removed" /> : <Pill status="ACTIVE" label="Has access" />}</div>
            {p.revokedAt ? <p className="small muted">Removed {when(p.revokedAt)}: {p.revokeReason}</p> : null}
            {!p.revokedAt && company && (w.side === p.side ? (p.side === "SENDER" ? canSender : canRecipient) : false) ? (
              <details className="inline"><summary>Change access</summary>
                <form action={updateParticipantAction} className="stack">{id}{hidden("participantId", p.id)}<PermBoxes p={p} /><Field label="Access ends on (optional)"><input name="expiresOn" type="date" /></Field><button className="btn" type="submit">Save</button></form>
                <form action={revokeParticipantAction} className="row">{id}{hidden("participantId", p.id)}<input name="reason" placeholder="Why" required minLength={3} aria-label="Why" /><button className="btn" type="submit">Remove access</button></form></details>
            ) : null}
            {!p.revokedAt && p.userId === w.me?.userId && !(company && mySideSpeaks) ? (
              <details className="inline"><summary>Leave</summary><form action={revokeParticipantAction} className="row">{id}{hidden("participantId", p.id)}<input name="reason" placeholder="Why" required minLength={3} aria-label="Why" /><button className="btn" type="submit">Leave</button></form></details>
            ) : null}
          </div></li>))} />
        {company && mySideSpeaks && open ? (
          <details className="inline"><summary>Give a colleague access</summary>
            <form action={addParticipantAction} className="stack">{id}
              <Field label="Colleague"><select name="userId" required defaultValue=""><option value="">Choose…</option>{extras.colleagues.filter((m) => !taken.has(m.userId)).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></Field>
              <PermBoxes /><Field label="Access ends on (optional)"><input name="expiresOn" type="date" /></Field><button className="btn" type="submit">Give access</button></form></details>
        ) : null}
      </section>

      {(open || c.status === "SUSPENDED") && mySideSpeaks ? (
        <section className="card stack"><h2>Manage</h2>
          <div className="row">
            {open ? (
              <details className="inline"><summary>Suspend for now</summary>
                <form action={suspendAction} className="stack">{id}<Field label="Reason"><input name="reason" required minLength={3} maxLength={500} /></Field><button className="btn" type="submit">Suspend</button></form></details>
            ) : null}
            {suspendedByMe ? <form action={resumeAction}>{id}<button className="btn" type="submit">Resume</button></form> : null}
            <details className="inline"><summary>Finish the collaboration</summary>
              <form action={endAction} className="stack">{id}<Field label="Why it is finished"><input name="note" required minLength={3} maxLength={500} /></Field><button className="btn" type="submit">Finish</button></form></details>
          </div></section>
      ) : null}

      <section className="card stack"><h2>History</h2>
        <p className="small muted">Every step is recorded here and cannot be changed.</p>
        {w.events.length === 0 ? <p className="muted">Nothing yet.</p> : <ShowMore noun="earlier entries" limit={6} items={w.events.map((e) => <li key={e.id}><div><span className="small muted">{dt(e.createdAt)} · {e.actorName}</span><div>{e.summary}</div></div></li>)} />}
      </section>
      <p className="small"><Link href={base}>All collaborations</Link></p>
    </div>
  );
}
