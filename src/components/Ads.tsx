import Link from "next/link";
import { advertisableListings, myCampaigns, readAdConfig, type CampaignReport } from "@/lib/services/ads";
import type { Payer } from "@/lib/services/billing";
import { entitlementIn } from "@/lib/services/subscriptions";
import { withTenant, withUser } from "@/lib/db";
import { PHASE_TEXT, PLACEMENTS, PLACEMENT_KEYS, phaseOf, type Placement } from "@/lib/ad-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Field, Pill, ShowMore } from "@/components/ui";
import SaveDocument from "@/components/SaveDocument";
import { createCampaignAction, deleteCampaignAction, endCampaignAction, pauseCampaignAction, resumeCampaignAction, submitCampaignAction, updateCampaignAction } from "@/app/ads/actions";

const phaseTone = (p: string) => (p === "LIVE" ? "ACTIVE" : p === "SUSPENDED" || p === "REJECTED" ? "SUSPENDED" : p === "ENDED" || p === "NOT_SUBMITTED" || p === "PAUSED" ? "NEUTRAL" : "PENDING");

type Form = { id?: string; ref?: string; name: string; listingRef: string; placement: string; headline: string; startsOn: string; endsOn: string; budget: string; dailyCap: string };

function CampaignForm({ from, f, choices, cfg, action, submitLabel }: { from: "me" | "app"; f: Form; choices: { publicRef: string; title: string; city: string }[]; cfg: Awaited<ReturnType<typeof readAdConfig>>; action: (fd: FormData) => Promise<never>; submitLabel: string }) {
  return (
    <form action={action} className="stack">
      <input type="hidden" name="from" value={from} />
      {f.id ? <><input type="hidden" name="id" value={f.id} /><input type="hidden" name="ref" value={f.ref} /></> : null}
      <div className="fields">
        <Field label="Campaign name"><input name="name" required maxLength={80} defaultValue={f.name} /></Field>
        <Field label="Property"><select name="listingRef" required defaultValue={f.listingRef}>{f.listingRef ? null : <option value="">Choose a property</option>}{choices.map((c) => <option key={c.publicRef} value={c.publicRef}>{c.title} · {c.city}</option>)}</select></Field>
        <Field label="Where it appears" hint="You pay per click, and the price depends on the place."><select name="placement" defaultValue={f.placement || "HOME_FEATURED"}>{PLACEMENT_KEYS.map((p) => <option key={p} value={p}>{PLACEMENTS[p].label} · {formatKobo(cfg.cpcKobo[p])} a click</option>)}</select></Field>
        <Field label="Headline (optional)" hint="Up to 60 characters. No links, emails or phone numbers."><input name="headline" maxLength={60} defaultValue={f.headline} /></Field>
        <Field label="Starts"><input type="date" name="startsOn" required defaultValue={f.startsOn} /></Field>
        <Field label="Ends"><input type="date" name="endsOn" required defaultValue={f.endsOn} /></Field>
        <Field label="Budget (₦)" hint={`Paid in advance. ${formatKobo(cfg.minBudgetKobo)} to ${formatKobo(cfg.maxBudgetKobo)}.`}><input name="budget" required inputMode="decimal" defaultValue={f.budget} /></Field>
        <Field label="Daily limit (₦, optional)" hint="The most to spend in a day."><input name="dailyCap" inputMode="decimal" defaultValue={f.dailyCap} /></Field>
      </div>
      <button className="btn primary" type="submit">{submitLabel}</button>
    </form>
  );
}

export async function AdsPanel({ payer, from }: { payer: Payer; from: "me" | "app" }) {
  const [rows, choices, cfg, ent] = await Promise.all([
    myCampaigns(payer), advertisableListings(payer), readAdConfig(),
    (payer.companyId ? withTenant(payer.companyId, payer.userId, (tx) => entitlementIn(tx, { kind: "COMPANY", companyId: payer.companyId! }, "ADVERTISING")) : withUser(payer.userId, (tx) => entitlementIn(tx, { kind: "USER", userId: payer.userId }, "ADVERTISING"))),
  ]);
  const base = from === "app" ? "/app/ads" : "/me/ads";
  const now = new Date();
  const can = ent.access === "FULL" && (payer.companyId === null || payer.role === "COMPANY_SUPER_ADMIN");
  return (
    <div className="stack-lg">
      <section className="card stack">
        <h2>Advertising</h2>
        <p>Promote a published property above the ordinary results. Every advert is marked <strong>Sponsored</strong>, is reviewed first, and you pay only for real clicks from new visitors, never for your own people or for robots. Spending can never pass your budget.</p>
        {ent.access !== "FULL" ? <p className="small">{ent.explanation} {ent.access === "NONE" ? "Advertising is part of some plans." : ""} <Link href={from === "app" ? "/app/billing" : "/me/billing"}>See plans</Link></p> : <p className="small muted">{ent.limit !== null ? `Your plan allows ${ent.limit} ${ent.limit === 1 ? "campaign" : "campaigns"} at a time.` : "Your plan has no limit on campaigns."}</p>}
      </section>
      {can ? (
        <details className="inline"><summary>New campaign</summary>
          {choices.length === 0 ? <p className="muted">You have no published property to advertise yet.</p> : <CampaignForm from={from} f={{ name: "", listingRef: "", placement: "HOME_FEATURED", headline: "", startsOn: "", endsOn: "", budget: "", dailyCap: "" }} choices={choices} cfg={cfg} action={createCampaignAction} submitLabel="Save campaign" />}
        </details>
      ) : null}
      <section className="stack">
        <h2>Your campaigns</h2>
        {rows.length === 0 ? <p className="muted">No campaigns yet.</p> : (
          <ShowMore limit={6} noun="more campaigns" items={rows.map((c) => {
            const ph = phaseOf(c as never, now);
            return (
              <li key={c.id}><div className="row between"><div><Link href={`${base}/${c.ref}`}><strong>{c.name}</strong></Link> <span className="small muted">{c.ref} · {c.listing.title} · {PLACEMENTS[c.placement as Placement].label} · {formatKobo(c.spentKobo)} of {formatKobo(c.budgetKobo)} spent · {formatDate(c.startsOn)} to {formatDate(c.endsOn)}</span></div><Pill status={phaseTone(ph)} label={PHASE_TEXT[ph]} /></div></li>
            );
          })} />
        )}
      </section>
    </div>
  );
}

const money = (k: bigint | null) => (k === null ? "—" : formatKobo(k));

export function ReportView({ r }: { r: CampaignReport }) {
  const lift = r.organic.baselineViewsPerDay > 0 ? Math.round(((r.organic.viewsPerDay - r.organic.baselineViewsPerDay) / r.organic.baselineViewsPerDay) * 100) : null;
  return (
    <div className="stack-lg">
      <section className="stats" aria-label="Paid results">
        <div className="stat"><b>{r.paid.impressions}</b><span>Times shown</span></div>
        <div className="stat"><b>{r.paid.clicks}</b><span>Clicks ({r.paid.ctr}%)</span></div>
        <div className="stat"><b>{money(r.paid.spentKobo)}</b><span>Spent on {r.paid.billedClicks} paid {r.paid.billedClicks === 1 ? "click" : "clicks"}</span></div>
        <div className="stat"><b>{r.paid.enquiries}</b><span>Enquiries from the advert</span></div>
      </section>
      <section className="card stack">
        <h3>Paid and organic, kept apart</h3>
        <div className="table-wrap"><table><thead><tr><th></th><th>Paid (through the advert)</th><th>Organic (everything else)</th></tr></thead>
          <tbody>
            <tr><td>Visits to the property</td><td>{r.paid.views}</td><td>{r.organic.views}</td></tr>
            <tr><td>Enquiries</td><td>{r.paid.enquiries}</td><td>{r.organic.enquiries}</td></tr>
            <tr><td>Cost per click</td><td>{money(r.paid.costPerClickKobo)}</td><td>—</td></tr>
            <tr><td>Cost per enquiry</td><td>{money(r.paid.costPerEnquiryKobo)}</td><td>—</td></tr>
            <tr><td>Organic visits a day</td><td>—</td><td>{r.organic.viewsPerDay} during, {r.organic.baselineViewsPerDay} in the 14 days before{lift !== null ? ` (${lift >= 0 ? "+" : ""}${lift}%)` : ""}</td></tr>
          </tbody></table></div>
        <p className="small muted">A visit counts as paid only if the visitor came through this advert. Visits and enquiries are counted once per visitor per day. Enquiries are counted as paid only when the same visitor clicked the advert that day.</p>
      </section>
      {r.daily.length > 0 ? (
        <details className="inline"><summary>Day by day</summary>
          <div className="table-wrap"><table><thead><tr><th>Day</th><th>Shown</th><th>Clicks</th><th>Paid clicks</th><th>Spent</th><th>Advert visits</th><th>Organic visits</th></tr></thead>
            <tbody>{r.daily.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.impressions}</td><td>{d.clicks}</td><td>{d.billedClicks}</td><td>{formatKobo(d.spentKobo)}</td><td>{d.paidViews}</td><td>{d.organicViews}</td></tr>)}</tbody></table></div>
        </details>
      ) : null}
      <div className="row"><SaveDocument url={`/ads/report/${r.campaign.ref}`} fallbackName={`${r.campaign.ref}-results.csv`} label="Save the results" /></div>
    </div>
  );
}

export async function AdDetail({ payer, from, r }: { payer: Payer; from: "me" | "app"; r: CampaignReport }) {
  const c = r.campaign;
  const [choices, cfg] = await Promise.all([advertisableListings(payer), readAdConfig()]);
  const base = from === "app" ? "/app/ads" : "/me/ads";
  const mayAct = payer.companyId === null || payer.role === "COMPANY_SUPER_ADMIN";
  const hidden = (<><input type="hidden" name="from" value={from} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="ref" value={c.ref} /></>);
  const editable = c.status === "DRAFT" || c.status === "REJECTED";
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="row between"><h2>{c.name}</h2><Pill status={phaseTone(r.phase)} label={PHASE_TEXT[r.phase]} /></div>
        <p className="small muted">{c.ref} · <Link href={`/properties/${c.listing.publicRef}`}>{c.listing.title}</Link> · {PLACEMENTS[c.placement as Placement].label} · {formatDate(c.startsOn)} to {formatDate(c.endsOn)}</p>
        <p>Budget {formatKobo(c.budgetKobo)} · paid in {formatKobo(c.fundedKobo)} · spent {formatKobo(c.spentKobo)} · left {formatKobo(r.remainingKobo > 0n ? r.remainingKobo : 0n)} · {formatKobo(c.cpcKobo)} a click{c.dailyCapKobo ? ` · up to ${formatKobo(c.dailyCapKobo)} a day` : ""}</p>
        {c.status === "REJECTED" ? <p className="flash error">Not approved: {c.reviewNote}</p> : null}
        {c.status === "SUSPENDED" ? <p className="flash error">Suspended: {c.suspendReason}</p> : null}
        {c.status === "ENDED" && c.endedReason ? <p className="small muted">Ended: {c.endedReason}.{r.remainingKobo > 0n ? ` ${formatKobo(r.remainingKobo)} was not spent. Ask the platform to refund it.` : ""}</p> : null}
        {r.phase === "WAITING_FOR_PAYMENT" ? <p className="flash notice">Approved. <Link href={from === "app" ? "/app/billing" : "/me/billing"}>Pay the budget</Link> and it starts on {formatDate(c.startsOn)}.</p> : null}
        {mayAct ? (
          <div className="row">
            {editable ? <form action={submitCampaignAction}>{hidden}<button className="btn primary" type="submit">Send for review</button></form> : null}
            {c.status === "APPROVED" ? <form action={pauseCampaignAction}>{hidden}<button className="btn" type="submit">Pause</button></form> : null}
            {c.status === "PAUSED" ? <form action={resumeCampaignAction}>{hidden}<button className="btn" type="submit">Resume</button></form> : null}
            {c.status === "APPROVED" || c.status === "PAUSED" || c.status === "SUSPENDED" ? <details className="inline"><summary>End campaign</summary><form action={endCampaignAction} className="stack">{hidden}<p className="small muted">This cannot be undone. Budget not spent stays yours and can be refunded.</p><button className="btn" type="submit">End it</button></form></details> : null}
            {editable && c.fundedKobo === 0n ? <details className="inline"><summary>Delete</summary><form action={deleteCampaignAction} className="stack">{hidden}<button className="btn" type="submit">Delete campaign</button></form></details> : null}
          </div>
        ) : null}
        {editable && mayAct ? (
          <details className="inline"><summary>Change the campaign</summary>
            <CampaignForm from={from} f={{ id: c.id, ref: c.ref, name: c.name, listingRef: c.listing.publicRef, placement: c.placement, headline: c.headline, startsOn: c.startsOn.toISOString().slice(0, 10), endsOn: c.endsOn.toISOString().slice(0, 10), budget: String(Number(c.budgetKobo) / 100), dailyCap: c.dailyCapKobo ? String(Number(c.dailyCapKobo) / 100) : "" }} choices={choices} cfg={cfg} action={updateCampaignAction} submitLabel="Save changes" />
          </details>
        ) : null}
      </section>
      <ReportView r={r} />
      <p><Link href={base}>Back to campaigns</Link></p>
    </div>
  );
}

