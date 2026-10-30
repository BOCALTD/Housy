import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { crmOverview, myFollowUps, pendingEnquiries, quietLeads } from "@/lib/services/crm";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { completeFollowUpAction, makeLeadFromEnquiryAction, planFollowUpAction } from "./actions";

export const metadata = { title: "Clients and leads" };

export default async function CrmPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("crm.view");
  const [o, followUps, quiet, enquiries] = await Promise.all([crmOverview(member), myFollowUps(member, 7), quietLeads(member).catch(() => []), can(member.role, "enquiry.view") && can(member.role, "crm.manage") ? pendingEnquiries(member) : Promise.resolve([])]);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Clients and leads</h1>
        <p className="muted">Everyone who has shown interest, where each lead stands, and what you promised to do next. You see your own clients{can(member.role, "crm.assign") ? " and everyone else's, as a manager" : ", and your team's if you lead one"}.</p>
        <div className="row"><Link className="btn" href="/app/crm/clients">Clients</Link><Link className="btn" href="/app/crm/leads">Leads</Link>{can(member.role, "crm.configure") ? <Link className="btn" href="/app/crm/setup">Setup</Link> : null}</div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{o.clients}</b><span>Clients</span></div>
        <div className="stat"><b>{o.newLeads}</b><span>New leads</span></div>
        <div className="stat"><b>{o.contacted}</b><span>Contacted</span></div>
        <div className="stat"><b>{o.qualified}</b><span>Qualified</span></div>
        <div className="stat"><b>{o.converted}</b><span>Converted</span></div>
        <div className="stat"><b>{o.dueFollowUps}</b><span>Your follow-ups due</span></div>
      </section>
      <section className="card">
        <h2>Follow-ups due in the next 7 days</h2>
        {followUps.length === 0 ? <p className="muted">Nothing due.</p> : (
          <ShowMore noun="more follow-ups" limit={5} items={followUps.map((f) => (
            <li key={f.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="row between"><div><Link href={`/app/crm/clients/${f.client.id}`}><strong>{f.subject}</strong></Link><div className="small muted">{f.client.ref} {f.client.name} · due {formatDate(f.dueOn)}</div></div>{f.overdue ? <Pill status="OVERDUE" label="Overdue" /> : null}</div>
              <details className="inline"><summary>Mark done</summary>
                <form action={completeFollowUpAction} className="stack"><input type="hidden" name="activityId" value={f.id} /><input type="hidden" name="back" value="/app/crm" />
                  <label>What happened<input name="outcome" /></label><button className="btn primary" type="submit">Done</button></form>
              </details>
            </div></li>))} />
        )}
      </section>
      {quiet.length > 0 ? (
        <section className="card stack" aria-labelledby="quiet-h">
          <h2 id="quiet-h">Gone quiet ({quiet.length})</h2>
          <p className="small muted">Open leads with no call, email, meeting or WhatsApp logged for a while and no follow-up planned. A suggestion from your records; plan a follow-up or close the lead.</p>
          <ShowMore noun="more leads" limit={5} items={quiet.map((q) => (
            <li key={q.lead.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
              <div className="row between">
                <div><Link href={`/app/crm/clients/${q.client.id}`}><strong>{q.client.name}</strong></Link><div className="small muted">{q.lead.ref} {q.lead.title}{q.mine ? "" : " · a teammate's lead"}</div></div>
                <span className={`pill ${q.level === "high" ? "bad" : "warn"}`}>{q.days} days</span>
              </div>
              <span className="small">{q.reason}</span>
              {can(member.role, "crm.manage") ? (
                <details className="inline"><summary>Plan a follow-up</summary>
                  <form action={planFollowUpAction} className="row">
                    <input type="hidden" name="clientId" value={q.client.id} /><input type="hidden" name="leadId" value={q.lead.id} />
                    <input name="subject" required minLength={2} maxLength={200} defaultValue={`Follow up: ${q.lead.title}`.slice(0, 200)} aria-label="Subject" style={{ flex: "1 1 220px" }} />
                    <input type="date" name="dueOn" required aria-label="Due on" />
                    <button className="btn primary" type="submit">Plan it</button>
                  </form>
                </details>
              ) : null}
            </div></li>))} />
        </section>
      ) : null}
      {enquiries.length > 0 ? (
        <section className="card">
          <h2>Website enquiries not yet followed up</h2>
          <ShowMore noun="more enquiries" limit={4} items={enquiries.map((e) => (
            <li key={e.id}><div className="row between" style={{ width: "100%" }}>
              <div><strong>{e.name}</strong> · {e.contact}<div className="small muted">{e.listing.title} · {formatDate(e.createdAt)}</div></div>
              <form action={makeLeadFromEnquiryAction}><input type="hidden" name="enquiryId" value={e.id} /><button className="btn" type="submit">Make lead</button></form>
            </div></li>))} />
        </section>
      ) : null}
    </div>
  );
}
