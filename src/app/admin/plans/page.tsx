import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { companyChoices, listPlans, listSubscriptions } from "@/lib/services/subscriptions";
import { readSettings, readYearlyMonths } from "@/lib/services/platform-settings";
import { ENTITLEMENT_KEYS, ENTITLEMENT_LABELS, COUNTED_ENTITLEMENTS } from "@/lib/subscription-rules";
import { formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { CURRENCIES, CURRENCY_CODES, moneyInput } from "@/lib/regions";
import { humanize } from "@/lib/labels";
import { tierLabel } from "@/lib/tier-rules";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { promoCodes, upgradeStats } from "@/lib/services/upgrades";
import { promoActiveAction, savePromoAction, yearlyAction, assignAction, cancelAction, renewAction, savePlanAction, settingsAction } from "./actions";

export const metadata = { title: "Plans and limits" };
export const dynamic = "force-dynamic";

const stateTone = (s: string) => (s === "ACTIVE" || s === "TRIAL" ? "ACTIVE" : s === "GRACE" || s === "READ_ONLY" ? "PENDING" : "SUSPENDED");

export default async function PlansPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const [plans, subs, companies, settings, promos, stats] = await Promise.all([listPlans(admin.id), listSubscriptions(admin.id), companyChoices(admin.id), readSettings(), promoCodes(admin.id), upgradeStats(admin.id)]);
  const yearlyMonths = await readYearlyMonths();
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "No finished trials yet");
  const planForm = (p?: (typeof plans)[number]) => (
    <form action={savePlanAction} className="stack">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <div className="fields">
        {p ? null : <Field label="Code" hint="Letters, numbers and hyphens. Cannot change later."><input name="code" required /></Field>}
        <Field label="Name"><input name="name" required defaultValue={p?.name ?? ""} /></Field>
        <Field label="For"><select name="audience" defaultValue={p?.audience ?? "SEEKER"}><option value="SEEKER">Seekers</option><option value="AGENT">Agents</option><option value="COMPANY">Companies</option></select></Field>
        <Field label="Price (₦)" hint="The main price, in naira. Leave empty if not set."><input name="price" inputMode="decimal" defaultValue={p?.priceKobo != null ? String(Number(p.priceKobo) / 100) : ""} /></Field>
        <Field label="Billing"><select name="billingPeriod" defaultValue={p?.billingPeriod ?? "MONTHLY"}>{["NONE", "MONTHLY", "QUARTERLY", "YEARLY"].map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</select></Field>
        <Field label="Trial days"><input name="trialDays" inputMode="numeric" defaultValue={p?.trialDays ?? 0} /></Field>
        <Field label="Grace days" hint="Everything still works after expiry."><input name="graceDays" inputMode="numeric" defaultValue={p?.graceDays ?? 7} /></Field>
        <Field label="Read-only days" hint="After grace: look but not add."><input name="readOnlyDays" inputMode="numeric" defaultValue={p?.readOnlyDays ?? 30} /></Field>
        <Field label="Perks level" hint="Basic: free. Pro: free promotions. Elite: Elite badge, Premium tag, automatic boost, free promotions."><select name="tier" defaultValue={p?.tier ?? "BASIC"}>{["BASIC", "SILVER", "GOLD"].map((b) => <option key={b} value={b}>{tierLabel(b)}</option>)}</select></Field>
        <Field label="Order"><input name="sortOrder" inputMode="numeric" defaultValue={p?.sortOrder ?? 100} /></Field>
      </div>
      {true ? (
        <details className="vp-fold">
          <summary>Prices in other currencies{p?.prices.length ? ` (${p.prices.length})` : ""}</summary>
          <p className="small muted">For workspaces and people outside Nigeria. Leave a currency empty and they pay the naira price.</p>
          <div className="fields">
            {CURRENCY_CODES.filter((c) => c !== "NGN").map((c) => {
              const pr = p?.prices.find((x) => x.currency === c);
              return <Field key={c} label={`${CURRENCIES[c].name} (${CURRENCIES[c].symbol.trim()})`}><input name={`cur_${c}`} inputMode="decimal" defaultValue={pr ? moneyInput(pr.amountMinor) : ""} /></Field>;
            })}
          </div>
        </details>
      ) : null}
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
        <p className="muted">You control plan names, prices, trials, what happens after expiry, and which features each plan switches on. Plans are paid online (Paystack or Stripe, by country) or by bank transfer you confirm under Payments. <Link href="/admin">Back to platform administration</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Plans ({plans.length})</h2>
        <ShowMore noun="more plans" limit={4} items={plans.map((p) => (
          <li key={p.id}><div style={{ width: "100%" }}>
            <div className="row between"><div><strong>{p.name}</strong> <span className="small muted">{humanize(p.audience)} · {p.priceKobo == null ? "price not set" : formatKobo(p.priceKobo, "NGN")}{p.prices.length ? ` (also ${p.prices.map((x) => formatKobo(x.amountMinor, x.currency)).join(", ")})` : ""} · {humanize(p.billingPeriod)} · {p._count.subscriptions} subscribed{p.active ? "" : " · not available"}</span></div></div>
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
                {s.status === "CANCELLED" ? null : <form action={cancelAction} className="row"><input type="hidden" name="subscriptionId" value={s.id} /><Field label="Reason"><input name="note" /></Field><button className="btn" type="submit" data-confirm="Cancel at the end of the period?" data-confirm-body="The plan stays active until then." data-confirm-ok="Cancel plan" data-confirm-tone="default">Cancel at end of period</button></form>}
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

      <section className="card stack" aria-labelledby="funnel-h">
        <h2 id="funnel-h">How upgrades are going</h2>
        <div className="fields">
          <div><div className="small muted">Paying subscribers</div><strong className="num" style={{ fontSize: 22 }}>{stats.byPlan.reduce((n, r) => n + r.active, 0)}</strong></div>
          <div><div className="small muted">Free trials running</div><strong className="num" style={{ fontSize: 22 }}>{stats.trials}</strong></div>
          <div><div className="small muted">Trials that paid (last 90 days)</div><strong className="num" style={{ fontSize: 22 }}>{stats.finishedTrials ? `${stats.converted} of ${stats.finishedTrials}` : "0"}</strong> <span className="small muted">{pct(stats.converted, stats.finishedTrials)}</span></div>
          <div><div className="small muted">Plan income, last 30 days</div><strong className="num" style={{ fontSize: 22 }}>{stats.revenue.length ? stats.revenue.map((r) => formatKobo(r.minor, r.currency)).join(" + ") : formatKobo(0n)}</strong> <span className="small muted">{stats.revenue.reduce((n, r) => n + r.count, 0)} payments</span></div>
        </div>
        {stats.byPlan.length ? (
          <details className="vp-fold"><summary>By plan ({stats.byPlan.length})</summary>
            <div className="table-wrap"><table><thead><tr><th scope="col">Plan</th><th scope="col">Paying</th><th scope="col">On trial</th></tr></thead>
              <tbody>{stats.byPlan.map((r) => <tr key={r.plan}><td>{r.plan}</td><td className="num">{r.active}</td><td className="num">{r.trial}</td></tr>)}</tbody></table></div>
          </details>
        ) : <p className="small muted">Nobody holds a plan yet.</p>}
        <p className="small muted">Set &ldquo;Trial days&rdquo; on a plan to let people try it free once. A short trial (7 to 14 days) on your middle plan usually brings the most paying customers.</p>
      </section>

      <section className="card stack" aria-labelledby="yearly-h">
        <h2 id="yearly-h">Paying yearly</h2>
        <p className="muted">Monthly plans can be paid for a year at once, for fewer months&apos; price. Customers pay up front and stay longer. It applies to every monthly plan in every currency.</p>
        <form action={yearlyAction} className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="A year costs" hint="10 months means two months free. Choose 0 to offer monthly only.">
            <select name="months" defaultValue={String(yearlyMonths === 12 ? 0 : yearlyMonths)}>
              <option value="0">No yearly option</option>
              {[11, 10, 9, 8].map((n) => <option key={n} value={n}>{n} months ({12 - n} free)</option>)}
            </select>
          </Field>
          <button className="btn primary" type="submit" data-confirm="Change the yearly price?" data-confirm-body="New yearly prices show at once. People already paying keep their price until they renew." data-confirm-ok="Save" data-confirm-tone="default">Save</button>
        </form>
      </section>

      <section className="card stack" aria-labelledby="promo-h">
        <h2 id="promo-h">Promo codes</h2>
        <p className="muted">Codes people type on the upgrades page to take money off the first period of a plan. Use them for launches, events and partners.</p>
        <details className="vp-fold"><summary>Create a code</summary>
          <form action={savePromoAction} className="stack">
            <div className="fields">
              <Field label="Code" hint="4 to 30 letters or digits, such as LAUNCH25"><input name="code" required maxLength={30} autoCapitalize="characters" autoComplete="off" /></Field>
              <Field label="Note for you" hint="Not shown to customers"><input name="description" maxLength={200} /></Field>
              <Field label="Kind of discount"><select name="kind" defaultValue="percent"><option value="percent">A percentage off</option><option value="amount">An amount off</option></select></Field>
              <Field label="Percentage off" hint="1 to 100, for a percentage code"><input name="percentOff" inputMode="numeric" /></Field>
              <Field label="Amount off" hint="For an amount code"><input name="amountOff" inputMode="decimal" /></Field>
              <Field label="Currency of the amount"><select name="currency" defaultValue="NGN">{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
              <Field label="Times it can be used" hint="Leave empty for no limit"><input name="maxRedemptions" inputMode="numeric" /></Field>
              <Field label="Starts on" hint="Leave empty to start now"><input type="date" name="startsAt" /></Field>
              <Field label="Ends on" hint="Leave empty for no end"><input type="date" name="endsAt" /></Field>
            </div>
            <fieldset className="stack"><legend className="small">Works for these plans (none ticked means every plan)</legend>
              <div className="row" style={{ flexWrap: "wrap" }}>{plans.filter((p) => p.priceKobo && p.priceKobo > 0n).map((p) => <label key={p.id} className="check"><input type="checkbox" name="planIds" value={p.id} /> {p.name}</label>)}</div>
            </fieldset>
            <label className="check"><input type="checkbox" name="perOwnerOnce" defaultChecked /> Each person or company can use it once</label>
            <label className="check"><input type="checkbox" name="newCustomersOnly" /> Only for people who have never paid for a plan</label>
            <div><button className="btn primary" type="submit" data-confirm="Create this promo code?" data-confirm-body="Anyone who has the code can use it within the limits you set. You can switch it off at any time." data-confirm-ok="Create code" data-confirm-tone="default">Create code</button></div>
          </form>
        </details>
        {promos.length === 0 ? <p className="small muted">No codes yet.</p> : (
          <ShowMore limit={5} noun="more codes" items={promos.map((c) => (
            <li key={c.id}>
              <div className="row between" style={{ flexWrap: "wrap" }}>
                <div><strong>{c.code}</strong> <span className="small muted">{c.percentOff != null ? `${c.percentOff}% off` : `${formatKobo(c.amountOffMinor ?? 0n, c.currency)} off`} · used {c.uses}{c.maxRedemptions != null ? ` of ${c.maxRedemptions}` : ""} times{c.given.length ? ` · ${c.given.map((g) => formatKobo(g.minor, g.currency)).join(" + ")} given` : ""}{c.endsAt ? ` · ends ${formatDate(c.endsAt)}` : ""}{c.planIds.length ? ` · ${c.planIds.length} ${c.planIds.length === 1 ? "plan" : "plans"}` : " · every plan"}{c.description ? ` · ${c.description}` : ""}</span></div>
                <form action={promoActiveAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? "" : "on"} />
                  <button className="btn small" type="submit" data-confirm={c.active ? `Switch ${c.code} off?` : `Switch ${c.code} on?`} data-confirm-body={c.active ? "Nobody can use it after this. Invoices already raised with it keep their discount." : "People can use it again within its limits."} data-confirm-ok={c.active ? "Switch off" : "Switch on"} data-confirm-tone={c.active ? "danger" : "default"}>{c.active ? "Switch off" : "Switch on"}</button></form>
              </div>
            </li>
          ))} />
        )}
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
