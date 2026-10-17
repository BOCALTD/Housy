import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { ACTIVITY_KINDS, CLIENT_KINDS, FINANCING, MATCH_STATUSES, TIMELINES, getClient, matchesFor } from "@/lib/services/crm";
import { dealOptions } from "@/lib/services/deal";
import { leadTransitionProblem, type LeadStatus } from "@/lib/crm-rules";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createDealAction } from "../../../deals/actions";
import {
  addActivityAction, addRequirementAction, archiveClientAction, assignLeadAction, completeFollowUpAction, createLeadAction, dismissDuplicateAction, leadStatusAction, matchStatusAction,
  mergeClientsAction, reassignClientAction, requirementActiveAction, updateClientAction, updateQualificationAction,
} from "../../actions";

export const metadata = { title: "Client" };
const ORDER: LeadStatus[] = ["CONTACTED", "QUALIFIED", "LOST"];

export default async function ClientPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const member = await requireMember("crm.view");
  const d = await getClient(member, params.id);
  if (!d) notFound();
  const { client: c } = d;
  const manage = can(member.role, "crm.manage") && d.canChange && !c.archivedAt;
  const assign = can(member.role, "crm.assign");
  const merge = can(member.role, "crm.merge");
  const matches = await Promise.all(d.requirements.filter((r) => r.active).map(async (r) => [r.id, await matchesFor(member, r.id)] as const));
  const matchMap = new Map(matches);
  const assets = manage ? await dealOptions(member) : [];
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>{c.ref} · {c.name}</h1>
        <p className="muted">{humanize(c.kind)} · owner {d.names[c.ownerId] ?? "unknown"}{c.city ? ` · ${c.city}` : ""} <Link href="/app/crm/clients">All clients</Link></p>
        <div className="row">{c.confidential ? <Pill status="WARN" label="Confidential" /> : null}{c.archivedAt ? <Pill status="ARCHIVED" label={c.mergedIntoId ? "Merged" : "Archived"} /> : null}{c.marketingConsent ? <Pill status="OK" label="Agreed to marketing" /> : <span className="small muted">No marketing consent recorded</span>}</div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card">
        <h2>Contact</h2>
        <p>{c.email || "No email"} · {c.phone || "No phone"}{c.address ? ` · ${c.address}` : ""}</p>
        {c.notes ? <details className="inline"><summary>Notes</summary><p style={{ whiteSpace: "pre-wrap" }}>{c.notes}</p></details> : null}
        {manage ? (
          <details className="inline"><summary>Edit details</summary>
            <form action={updateClientAction} className="stack"><input type="hidden" name="clientId" value={c.id} />
              <div className="fields">
                <Field label="Type"><select name="kind" defaultValue={c.kind}><EnumOptions values={CLIENT_KINDS} /></select></Field>
                <Field label="Name"><input name="name" defaultValue={c.name} required /></Field>
                <Field label="Email"><input name="email" type="email" defaultValue={c.email} /></Field>
                <Field label="Phone"><input name="phone" defaultValue={c.phone} /></Field>
                <Field label="City"><input name="city" defaultValue={c.city} /></Field>
                <Field label="Address"><input name="address" defaultValue={c.address} /></Field>
              </div>
              <Field label="Notes"><textarea name="notes" rows={3} defaultValue={c.notes} /></Field>
              <label className="row"><input type="checkbox" name="confidential" defaultChecked={c.confidential} /> Confidential</label>
              <label className="row"><input type="checkbox" name="marketingConsent" defaultChecked={c.marketingConsent} /> Agreed to receive marketing messages</label>
              <label className="row"><input type="checkbox" name="notDuplicate" /> The contact details match another client, but this is a different person</label>
              <button className="btn primary" type="submit">Save</button>
            </form>
          </details>
        ) : null}
      </section>

      {d.duplicates.length > 0 ? (
        <section className="card">
          <h2>Possible duplicates</h2>
          <ShowMore noun="more possible duplicates" limit={3} items={d.duplicates.map((x) => (
            <li key={x.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div>{x.visible ? <Link href={`/app/crm/clients/${x.id}`}><strong>{x.ref}</strong> {x.name}</Link> : <strong>{x.ref}</strong>}{x.visible ? "" : " (held by someone else)"} <span className="small muted">{x.reasons.join(", ")}</span></div>
              <div className="row">
                {manage ? <form action={dismissDuplicateAction}><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="otherId" value={x.id} /><button className="btn" type="submit">Different person</button></form> : null}
                {merge && manage ? <form action={mergeClientsAction}><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="otherId" value={x.id} /><button className="btn" type="submit">Merge into this record</button></form> : null}
              </div>
            </div></li>))} />
        </section>
      ) : null}

      <section className="card">
        <h2>Leads</h2>
        {d.leads.length === 0 ? <p className="muted">No leads yet.</p> : (
          <ShowMore noun="more leads" limit={3} items={d.leads.map((l) => (
            <li key={l.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
              <div className="row between"><div><strong>{l.ref}</strong> {l.title}<div className="small muted">Owner {d.names[l.ownerId] ?? "unknown"} · score {l.score}{l.budgetMaxKobo ? ` · up to ${formatKobo(l.budgetMaxKobo)}` : ""} · {humanize(l.timeline)} · {humanize(l.financing)}{l.decisionMaker ? " · decision maker" : ""}</div>{l.lostReason ? <div className="small muted">Lost: {l.lostReason}</div> : null}</div><Pill status={l.status} label={humanize(l.status)} /></div>
              {manage && l.status !== "CONVERTED" ? (
                <>
                  <details className="inline"><summary>Qualification</summary>
                    <form action={updateQualificationAction} className="stack"><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="leadId" value={l.id} />
                      <div className="fields">
                        <Field label="Interested in"><input name="title" defaultValue={l.title} required /></Field>
                        <Field label="Highest budget (₦)"><input name="budgetMax" inputMode="decimal" defaultValue={l.budgetMaxKobo ? String(Number(l.budgetMaxKobo) / 100) : ""} /></Field>
                        <Field label="Timeline"><select name="timeline" defaultValue={l.timeline}><EnumOptions values={TIMELINES} /></select></Field>
                        <Field label="Financing"><select name="financing" defaultValue={l.financing}><EnumOptions values={FINANCING} /></select></Field>
                      </div>
                      <label className="row"><input type="checkbox" name="decisionMaker" defaultChecked={l.decisionMaker} /> Speaking to the decision maker</label>
                      <button className="btn primary" type="submit">Save</button></form>
                  </details>
                  <details className="inline"><summary>Move lead</summary>
                    <form action={leadStatusAction} className="stack"><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="leadId" value={l.id} />
                      <Field label="Move to"><select name="to" defaultValue="">{ORDER.filter((s) => !leadTransitionProblem(l.status as LeadStatus, s)).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
                      <Field label="Reason (needed if lost)"><input name="reason" /></Field>
                      <button className="btn primary" type="submit">Move</button></form>
                  </details>
                </>
              ) : null}
              {assign && !["CONVERTED", "LOST"].includes(l.status) ? (
                <details className="inline"><summary>Reassign</summary>
                  <form action={assignLeadAction} className="stack"><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="leadId" value={l.id} />
                    <Field label="New owner"><select name="ownerId" required defaultValue="">{<option value="" disabled>Choose</option>}{d.agents.filter((a) => a.id !== l.ownerId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                    <Field label="Reason"><input name="reason" required /></Field><button className="btn primary" type="submit">Reassign</button></form>
                </details>
              ) : null}
            </div></li>))} />
        )}
        {manage ? (
          <details className="inline"><summary>New lead</summary>
            <form action={createLeadAction} className="stack"><input type="hidden" name="clientId" value={c.id} />
              <div className="fields">
                <Field label="Interested in"><input name="title" required /></Field>
                <Field label="Source"><select name="sourceId" defaultValue=""><option value="">Not known</option>{d.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                <Field label="Highest budget (₦)"><input name="budgetMax" inputMode="decimal" /></Field>
                <Field label="Timeline"><select name="timeline" defaultValue="UNKNOWN"><EnumOptions values={TIMELINES} /></select></Field>
                <Field label="Financing"><select name="financing" defaultValue="UNKNOWN"><EnumOptions values={FINANCING} /></select></Field>
                {assign ? <Field label="Owner" hint="Leave empty to give it to the agent with the fewest open leads."><select name="ownerId" defaultValue=""><option value="">Fewest open leads</option>{d.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field> : null}
              </div>
              <label className="row"><input type="checkbox" name="decisionMaker" /> Speaking to the decision maker</label>
              <button className="btn primary" type="submit">Open lead</button></form>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Deals</h2>
        {d.deals.length === 0 ? <p className="muted">No deals yet.</p> : (
          <ShowMore noun="more deals" limit={3} items={d.deals.map((x) => (
            <li key={x.id}><div className="row between" style={{ width: "100%" }}><div><Link href={`/app/deals/${x.id}`}><strong>{x.ref}</strong> {x.title}</Link><div className="small muted">Owner {d.names[x.ownerId] ?? "unknown"}</div></div><div className="row"><Pill status={x.stage} label={humanize(x.stage)} />{x.status !== "OPEN" ? <Pill status={x.status} label={humanize(x.status)} /> : null}</div></div></li>))} />
        )}
        {manage ? (
          <details className="inline"><summary>Open a deal</summary>
            <form action={createDealAction} className="stack"><input type="hidden" name="clientId" value={c.id} />
              <div className="fields">
                <Field label="Property"><select name="assetId" required defaultValue=""><option value="" disabled>Choose</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
                <Field label="Type"><select name="type" defaultValue=""><option value="">From the listing</option><option value="SALE">Sale</option><option value="RENT">Rent</option><option value="LEASE">Lease</option></select></Field>
                <Field label="From lead" hint="Only a qualified lead can become a deal."><select name="leadId" defaultValue=""><option value="">No lead</option>{d.leads.filter((l) => l.status === "QUALIFIED").map((l) => <option key={l.id} value={l.id}>{l.ref} · {l.title}</option>)}</select></Field>
                <Field label="Asking price (₦)" hint="Leave empty to use the listing price."><input name="asking" inputMode="decimal" /></Field>
                <Field label="Expected to close"><input name="expectedCloseOn" type="date" /></Field>
              </div>
              <Field label="Title"><input name="title" /></Field>
              <button className="btn primary" type="submit">Open deal</button></form>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>What the client wants</h2>
        {d.requirements.length === 0 ? <p className="muted">No requirements recorded.</p> : (
          <ShowMore noun="more requirements" limit={2} items={d.requirements.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
              <div><strong>{humanize(r.purpose)}</strong> {r.assetClass ? humanize(r.assetClass) : "any type"} in {[r.city, r.state].filter(Boolean).join(", ")} · up to {formatKobo(r.budgetMaxKobo)}{r.bedroomsMin ? ` · ${r.bedroomsMin}+ bedrooms` : ""}{r.active ? "" : " (closed)"}</div>
              {r.active ? (
                <details className="inline"><summary>Matching listings ({matchMap.get(r.id)?.length ?? 0})</summary>
                  {(matchMap.get(r.id) ?? []).length === 0 ? <p className="muted">No published listing fits.</p> : (
                    <ShowMore noun="more matches" limit={3} items={(matchMap.get(r.id) ?? []).map((m) => (
                      <li key={m.listing.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
                        <div><strong>{m.listing.title}</strong> · {formatKobo(m.listing.priceKobo)} · score {m.score}<div className="small muted">{m.reasons.join(", ")}{m.match ? ` · ${humanize(m.match.status)}` : ""}</div></div>
                        {manage ? <form action={matchStatusAction} className="row"><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="requirementId" value={r.id} /><input type="hidden" name="listingId" value={m.listing.id} />
                          <select name="status" defaultValue={m.match?.status ?? "SUGGESTED"} aria-label="Status"><EnumOptions values={MATCH_STATUSES} /></select><input name="note" placeholder="Note" aria-label="Note" /><button className="btn" type="submit">Save</button></form> : null}
                      </div></li>))} />
                  )}
                </details>
              ) : null}
              {manage ? <form action={requirementActiveAction}><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="requirementId" value={r.id} /><input type="hidden" name="active" value={r.active ? "no" : "yes"} /><button className="btn" type="submit">{r.active ? "Close requirement" : "Reopen"}</button></form> : null}
            </div></li>))} />
        )}
        {manage ? (
          <details className="inline"><summary>Add a requirement</summary>
            <form action={addRequirementAction} className="stack"><input type="hidden" name="clientId" value={c.id} />
              <div className="fields">
                <Field label="Looking to"><select name="purpose" defaultValue="SALE"><option value="SALE">Buy</option><option value="RENT">Rent</option><option value="LEASE">Lease</option></select></Field>
                <Field label="Type"><select name="assetClass" defaultValue=""><option value="">Any</option><EnumOptions values={["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "OTHER"]} /></select></Field>
                <Field label="City"><input name="city" /></Field>
                <Field label="State"><input name="state" /></Field>
                <Field label="Bedrooms (at least)"><input name="bedroomsMin" inputMode="numeric" /></Field>
                <Field label="Lowest budget (₦)"><input name="budgetMin" inputMode="decimal" /></Field>
                <Field label="Highest budget (₦)"><input name="budgetMax" inputMode="decimal" required /></Field>
              </div>
              <Field label="Notes"><input name="notes" /></Field>
              <button className="btn primary" type="submit">Save requirement</button></form>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Calls, meetings and follow-ups</h2>
        {d.activities.length === 0 ? <p className="muted">Nothing recorded.</p> : (
          <ShowMore noun="more entries" limit={6} items={d.activities.map((a) => (
            <li key={a.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="row between"><div><strong>{a.subject}</strong><div className="small muted">{humanize(a.kind)} · {formatDateTime(a.occurredAt)}{a.dueOn ? ` · due ${formatDate(a.dueOn)}` : ""}{a.assigneeId ? ` · ${d.names[a.assigneeId] ?? ""}` : ""}</div></div>{a.kind === "FOLLOW_UP" ? <Pill status={a.doneAt ? "DONE" : "OPEN"} label={a.doneAt ? "Done" : "Open"} /> : null}</div>
              {a.body ? <details className="inline"><summary>Details</summary><p style={{ whiteSpace: "pre-wrap" }}>{a.body}</p></details> : null}
              {a.kind === "FOLLOW_UP" && !a.doneAt && !c.archivedAt ? <details className="inline"><summary>Mark done</summary>
                <form action={completeFollowUpAction} className="stack"><input type="hidden" name="activityId" value={a.id} /><input type="hidden" name="back" value={`/app/crm/clients/${c.id}`} /><Field label="What happened"><input name="outcome" /></Field><button className="btn primary" type="submit">Done</button></form></details> : null}
            </div></li>))} />
        )}
        {manage ? (
          <details className="inline"><summary>Record something</summary>
            <form action={addActivityAction} className="stack"><input type="hidden" name="clientId" value={c.id} />
              <div className="fields">
                <Field label="What"><select name="kind" defaultValue="CALL"><EnumOptions values={ACTIVITY_KINDS} /></select></Field>
                <Field label="Subject"><input name="subject" required /></Field>
                <Field label="Lead"><select name="leadId" defaultValue=""><option value="">None</option>{d.leads.map((l) => <option key={l.id} value={l.id}>{l.ref}</option>)}</select></Field>
                <Field label="Due date (follow-ups)"><input name="dueOn" type="date" /></Field>
              </div>
              <Field label="Details"><textarea name="body" rows={2} /></Field>
              <button className="btn primary" type="submit">Save</button></form>
          </details>
        ) : null}
      </section>

      {(assign || manage) && !c.mergedIntoId ? (
        <section className="card">
          <details className="inline"><summary>Ownership and archive</summary>
            <div className="stack">
              {assign ? <form action={reassignClientAction} className="stack"><input type="hidden" name="clientId" value={c.id} />
                <Field label="Hand client to"><select name="ownerId" required defaultValue=""><option value="" disabled>Choose</option>{d.agents.filter((a) => a.id !== c.ownerId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field label="Reason"><input name="reason" required /></Field><button className="btn primary" type="submit">Reassign client</button></form> : null}
              {d.canChange ? <form action={archiveClientAction}><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="restore" value={c.archivedAt ? "yes" : "no"} /><button className="btn" type="submit">{c.archivedAt ? "Restore client" : "Archive client"}</button></form> : null}
            </div>
          </details>
        </section>
      ) : null}
    </div>
  );
}
