import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { companyChoices, listPlans, listSubscriptions } from "@/lib/services/subscriptions";
import { readSettings } from "@/lib/services/platform-settings";
import { ENTITLEMENT_KEYS, ENTITLEMENT_LABELS, COUNTED_ENTITLEMENTS } from "@/lib/subscription-rules";
import { formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { assignAction, cancelAction, renewAction, savePlanAction, settingsAction } from "./actions";

export const metadata = { title: "Plans and limits" };
export const dynamic = "force-dynamic";

const stateTone = (s: string) => (s === "ACTIVE" || s === "TRIAL" ? "ACTIVE" : s === "GRACE" || s === "READ_ONLY" ? "PENDING" : "SUSPENDED");

export default async function PlansPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const [plans, subs, companies, settings] = await Promise.all([listPlans(admin.id), listSubscriptions(admin.id), companyChoices(admin.id), readSettings()]);
  const planForm = (p?: (typeof plans)[number]) => (
    <form action={savePlanAction} className="stack">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <div className="fields">
        {p ? null : <Field label="Code" hint="Letters, numbers and hyphens. Cannot change later."><input name="code" required /></Field>}
        <Field label="Name"><input name="name" required defaultValue={p?.name ?? ""} /></Field>
        <Field label="For"><select name="audience" defaultValue={p?.audience ?? "SEEKER"}><option value="SEEKER">Seekers</option><option value="AGENT">Agents</option><option value="COMPANY">Companies</option></select></Field>
        <Field label="Price (₦)" hint="Leave empty if not set."><input name="price" inputMode="decimal" defaultValue={p?.priceKobo != null ? String(Number(p.priceKobo) / 100) : ""} /></Field>
        <Field label="Billing"><select name="billingPeriod" defaultValue={p?.billingPeriod ?? "MONTHLY"}>{["NONE", "MONTHLY", "QUARTERLY", "YEARLY"].map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</select></Field>
        <Field label="Trial days"><input name="trialDays" inputMode="numeric" defaultValue={p?.trialDays ?? 0} /></Field>
        <Field label="Grace days" hint="Everything still works after expiry."><input name="graceDays" inputMode="numeric" defaultValue={p?.graceDays ?? 7} /></Field>
        <Field label="Read-only days" hint="After grace: look but not add."><input name="readOnlyDays" inputMode="numeric" defaultValue={p?.readOnlyDays ?? 30} /></Field>
        <Field label="Perks level" hint="Silver: free promotions. Gold: Golden badge, Premium tag, automatic boost, free promotions. Applies to company plans."><select name="tier" defaultValue={p?.tier ?? "BASIC"}>{["BASIC", "SILVER", "GOLD"].map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</select></Field>
        <Field label="Order"><input name="sortOrder" inputMode="numeric" defaultValue={p?.sortOrder ?? 100} /></Field>
      </div>
      <label className="row"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Available to assign</label>
      <fieldset className="stack"><legend className="small muted">Features</legend>
        {ENTITLEMENT_KEYS.map((k) => {
          const e = p?.entitlements.find((x) => x.key === k);
          return (
            <div key={k} className="row">
              <label className="row"><input type="checkbox" name={`on_${k}`} defaultChecked={!!e} /> {ENTITLEMENT_LABELS[k]}</label>
              {COUNTED_ENTITLEMENTS.includes(k) ? <input name={`limit_${k}`} inputMode="numeric" placeholder="No limit" defaultValue={e?.limit ?? ""} aria-label={`Limit for ${ENTITLEMENT_LABELS[k]}`} style={{ maxWidth: 110 }} /> : null}
            </div>
          );
        })}
      </fieldset>
      <button className="btn primary" type="submit">{p ? "Save plan" : "Add plan"}</button>
    </form>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><p className="eyebrow">Platform Super Super Admin</p><h1>Plans and limits</h1>
        <p className="muted">You control plan names, prices, trials, what happens after expiry, and which features each plan switches on. Payment is recorded by hand here until online payment is built. <Link href="/admin">Back to platform administration</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Plans ({plans.length})</h2>
        <ShowMore noun="more plans" limit={4} items={plans.map((p) => (
          <li key={p.id}><div style={{ width: "100%" }}>
            <div className="row between"><div><strong>{p.name}</strong> <span className="small muted">{humanize(p.audience)} · {p.priceKobo == null ? "price not set" : formatKobo(p.priceKobo)} · {humanize(p.billingPeriod)} · {p._count.subscriptions} subscribed{p.active ? "" : " · not available"}</span></div></div>
            <div className="small muted">{p.entitlements.length ? p.entitlements.map((e) => `${ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS] ?? e.key}${e.limit != null ? ` (${e.limit})` : ""}`).join(", ") : "No paid features"} · grace {p.graceDays} days, then read-only {p.readOnlyDays} days</div>
            <details className="inline"><summary>Edit</summary>{planForm(p)}</details>
          </div></li>))} />
        <details className="inline"><summary>Add a plan</summary>{planForm()}</details>
      </section>

      <section className="card stack">
        <h2>Subscriptions ({subs.length})</h2>
        {subs.length === 0 ? <p className="muted">Nobody holds a plan yet.</p> : (
          <ShowMore noun="more subscriptions" limit={6} items={subs.map((s) => (
            <li key={s.id}><div style={{ width: "100%" }}>
              <div className="row between"><div><strong>{s.ownerName}</strong> <span className="small muted">{s.plan.name} · until {formatDate(s.periodEnd)}</span></div><Pill status={stateTone(s.state)} label={humanize(s.state)} /></div>
              <details className="inline"><summary>Renew or cancel</summary>
                <form action={renewAction} className="row"><input type="hidden" name="subscriptionId" value={s.id} /><Field label="New end date"><input name="periodEnd" type="date" required /></Field><Field label="Note"><input name="note" /></Field><button className="btn" type="submit">Renew</button></form>
                {s.status === "CANCELLED" ? null : <form action={cancelAction} className="row"><input type="hidden" name="subscriptionId" value={s.id} /><Field label="Reason"><input name="note" /></Field><button className="btn" type="submit">Cancel at end of period</button></form>}
              </details>
            </div></li>))} />
        )}
        <details className="inline"><summary>Give someone a plan</summary>
          <form action={assignAction} className="stack">
            <div className="fields">
              <Field label="Plan"><select name="planId" required>{plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} ({humanize(p.audience)})</option>)}</select></Field>
              <Field label="Person's email" hint="For seeker and agent plans."><input name="email" type="email" /></Field>
              <Field label="Company" hint="For company plans."><select name="companyId" defaultValue=""><option value="">None</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Runs until"><input name="periodEnd" type="date" required /></Field>
              <Field label="Note"><input name="note" /></Field>
            </div>
            <label className="row"><input type="checkbox" name="trial" /> This is a trial</label>
            <button className="btn primary" type="submit">Save subscription</button>
          </form>
        </details>
      </section>

      <section className="card stack">
        <h2>Messaging and collaboration limits</h2>
        <form action={settingsAction} className="stack">
          <div className="fields">
            <Field label="Invitations expire after (days)"><input name="inviteExpiryDays" inputMode="numeric" defaultValue={settings.inviteExpiryDays} /></Field>
            <Field label="Messages per minute, per person"><input name="messagesPerMinute" inputMode="numeric" defaultValue={settings.messagesPerMinute} /></Field>
            <Field label="New conversations per day, per person"><input name="newConversationsPerDay" inputMode="numeric" defaultValue={settings.newConversationsPerDay} /></Field>
            <Field label="Phone numbers and emails in messages" hint="Applies to people whose plan does not include contact details."><select name="contactPolicy" defaultValue={settings.contactPolicy}><option value="MASK">Hide them</option><option value="BLOCK">Refuse the message</option></select></Field>
            <Field label="Reports before a person is paused"><input name="reportMuteThreshold" inputMode="numeric" defaultValue={settings.reportMuteThreshold} /></Field>
          </div>
          <button className="btn primary" type="submit">Save limits</button>
        </form>
      </section>
    </div>
  );
}
