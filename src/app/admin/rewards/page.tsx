import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminDisputes, adminRewardQueue, allPolicies, budgets, EVENT_LABELS, PROGRAMME_EVENTS, readRewardSettings, reconcile } from "@/lib/services/rewards";
import { listCampaigns } from "@/lib/services/referrals";
import { monthKey, REWARD_STATUSES } from "@/lib/reward-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import SaveDocument from "@/components/SaveDocument";
import { approveAction, budgetAction, cancelAction, clearAction, disputeDecisionAction, liftRestrictionAction, policyAction, rejectAction, restrictAction, retireAction, settingsAction } from "./actions";

export const metadata = { title: "Rewards" };
export const dynamic = "force-dynamic";

export default async function AdminRewardsPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const status = (REWARD_STATUSES as readonly string[]).includes(sp(searchParams, "status") ?? "") ? (sp(searchParams, "status") as (typeof REWARD_STATUSES)[number]) : "ELIGIBLE";
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const [q, policies, bud, disputes, rec, settings, campaigns] = await Promise.all([adminRewardQueue(admin.id, status, page), allPolicies(admin.id), budgets(admin.id), adminDisputes(admin.id), reconcile(admin.id), readRewardSettings(), listCampaigns(admin.id)]);
  const month = monthKey(new Date());
  const active = policies.filter((p) => p.active);
  const history = policies.filter((p) => !p.active);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Rewards</h1><p className="muted">Approve rewards, set what each event pays, and watch the budget. <Link href="/admin/rewards/payouts">Payouts</Link> · <Link href="/admin/referrals">Referrals</Link> · <Link href="/admin/vacancies">Vacancy reports</Link> · <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{q.counts.ELIGIBLE ?? 0}</b><span>To approve</span></div>
        <div className="stat"><b>{q.counts.UNDER_REVIEW ?? 0}</b><span>Held for checking</span></div>
        <div className="stat"><b>{disputes.length}</b><span>Open disputes</span></div>
        <div className="stat"><b>{rec.findings.length === 0 ? "Balanced" : `${rec.findings.length} to look at`}</b><span>Reconciliation</span></div>
      </section>

      <section className="card"><div className="row between"><h2>Queue</h2><SaveDocument url="/admin/rewards/export" fallbackName="reward-ledger.csv" /></div>
        <div className="row" role="tablist" aria-label="Status">{["ELIGIBLE", "UNDER_REVIEW", "APPROVED", "PAYABLE", "PAID", "REJECTED", "NOT_ELIGIBLE", "CANCELLED", "DISPUTED"].map((s) => <Link key={s} className={`btn${s === status ? " primary" : ""}`} href={`/admin/rewards?status=${s}`}>{humanize(s)} ({q.counts[s] ?? 0})</Link>)}</div>
        {q.items.length === 0 ? <p className="muted">Nothing here.</p> : (
          <ul className="timeline">{q.items.map((r) => (
            <li key={r.id}><div className="row between"><span><strong>{r.userName}</strong> <span className="small muted">{r.ref} · {humanize(r.event)} · {formatKobo(r.amountKobo)}{r.policyVersion ? ` · terms v${r.policyVersion}` : ""}</span></span><Pill status={r.status} /></div>
              <div className="small">{r.sourceLabel}{r.reason ? ` · ${r.reason}` : ""}</div>
              {r.flag ? <div className="small"><strong>Flag:</strong> {r.flag}</div> : null}
              <div className="row">
                {r.status === "ELIGIBLE" ? <form action={approveAction} className="row"><input type="hidden" name="rewardId" value={r.id} /><button className="btn primary" type="submit">Approve</button></form> : null}
                {r.status === "UNDER_REVIEW" ? <details className="inline"><summary>Clear</summary><form action={clearAction} className="row"><input type="hidden" name="rewardId" value={r.id} /><input name="note" required minLength={5} placeholder="What you checked" aria-label="What you checked" /><button className="btn" type="submit">Clear</button></form></details> : null}
                {["ELIGIBLE", "UNDER_REVIEW"].includes(r.status) ? <details className="inline"><summary>Reject</summary><form action={rejectAction} className="row"><input type="hidden" name="rewardId" value={r.id} /><input name="reason" required minLength={5} placeholder="Reason the person will read" aria-label="Reason" /><button className="btn" type="submit">Reject</button></form></details> : null}
                {["APPROVED", "PAYABLE"].includes(r.status) && !r.payoutId ? <details className="inline"><summary>Cancel</summary><form action={cancelAction} className="row"><input type="hidden" name="rewardId" value={r.id} /><input name="reason" required minLength={5} placeholder="Reason" aria-label="Reason" /><button className="btn" type="submit">Cancel reward</button></form></details> : null}
                <details className="inline"><summary>Pause this person&apos;s rewards</summary><form action={restrictAction} className="row"><input type="hidden" name="userId" value={r.userId} /><input name="reason" required minLength={5} placeholder="Reason, shown to them" aria-label="Reason" /><button className="btn" type="submit">Pause</button></form></details>
              </div>
            </li>))}</ul>
        )}
        <div className="row">{page > 1 ? <Link className="btn" href={`/admin/rewards?status=${status}&page=${page - 1}`}>Previous</Link> : null}{q.more ? <Link className="btn" href={`/admin/rewards?status=${status}&page=${page + 1}`}>Next</Link> : null}</div>
      </section>

      <section className="card"><h2>Disputes</h2>
        {disputes.length === 0 ? <p className="muted">No open disputes.</p> : (
          <ShowMore noun="more disputes" limit={3} items={disputes.map((d) => (
            <li key={d.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="small muted">{formatDate(d.createdAt)} · {d.reward?.ref ?? d.subjectType}{d.reward ? ` · ${humanize(d.reward.status)} · ${d.reward.reason}` : ""}</div>
              <div>{d.reason}</div>
              <details className="inline"><summary>Decide</summary><form action={disputeDecisionAction} className="stack"><input type="hidden" name="disputeId" value={d.id} /><Field label="Decision and reasons, shown to the person"><input name="resolution" required minLength={5} maxLength={1000} /></Field><div className="row"><button className="btn primary" type="submit" name="decision" value="uphold">Uphold</button><button className="btn" type="submit" name="decision" value="deny">Deny</button></div></form></details>
            </div></li>))} />
        )}
      </section>

      <section className="card"><h2>What each event pays</h2>
        <p className="small muted">A change never edits the old reward. It retires it and starts a new version, so every reward keeps the terms it was earned under.</p>
        {active.length === 0 ? <p className="muted">Nothing is set up. Without a reward, qualifying events are recorded as not eligible.</p> : (
          <ShowMore noun="more" limit={4} items={active.map((p) => <li key={p.id}><div className="row between"><span><strong>{p.name}</strong> <span className="small muted">v{p.version} · {EVENT_LABELS[p.event]} · {formatKobo(p.amountKobo)} · safety period {p.holdDays} days{p.perPersonLimit ? ` · ${p.perPersonLimit} per person` : ""}{p.campaignId ? ` · ${campaigns.find((c) => c.id === p.campaignId)?.name ?? "campaign"}` : ""}</span></span><form action={retireAction}><input type="hidden" name="policyId" value={p.id} /><button className="btn" type="submit">Retire</button></form></div></li>)} />
        )}
        <details className="inline"><summary>Set or change a reward</summary>
          <form action={policyAction} className="stack">
            <Field label="Programme"><select name="programme" defaultValue="REFERRAL"><option value="REFERRAL">Referral</option><option value="VACANCY">Vacancy</option></select></Field>
            <Field label="Event"><select name="event">{[...PROGRAMME_EVENTS.REFERRAL, ...PROGRAMME_EVENTS.VACANCY].map((e) => <option key={e} value={e}>{humanize(e)}</option>)}</select></Field>
            <Field label="Campaign" hint="Required for referral events."><select name="campaignId" defaultValue=""><option value="">None (vacancy)</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({humanize(c.event)})</option>)}</select></Field>
            <Field label="Name"><input name="name" required minLength={3} maxLength={120} /></Field>
            <Field label="Amount (naira)"><input name="amount" required inputMode="decimal" /></Field>
            <Field label="Safety period (days)" hint="After approval, the reward waits this long, and the source is checked again, before it becomes payable."><input name="holdDays" required inputMode="numeric" defaultValue="14" /></Field>
            <Field label="Limit per person" hint="Optional."><input name="perPersonLimit" inputMode="numeric" /></Field>
            <Field label="Terms shown to people"><textarea name="terms" rows={3} maxLength={2000} /></Field>
            <button className="btn primary" type="submit">Save reward</button>
          </form></details>
        {history.length ? <details className="inline"><summary>Earlier versions ({history.length})</summary><ul className="timeline">{history.slice(0, 30).map((p) => <li key={p.id}><span className="small">{p.name} v{p.version} · {formatKobo(p.amountKobo)} · retired {formatDate(p.retiredAt)}</span></li>)}</ul></details> : null}
      </section>

      <section className="card"><h2>Budgets</h2>
        <p className="small muted">A reward cannot be approved in a month with no budget, or beyond it.</p>
        {bud.length === 0 ? <p className="muted">No budgets yet.</p> : <ShowMore noun="more months" limit={4} items={bud.map((b) => <li key={b.id}><div className="row between"><span><strong>{humanize(b.programme)}</strong> {b.month}</span><span className="small">{formatKobo(b.spentKobo)} of {formatKobo(b.limitKobo)}</span></div></li>)} />}
        <details className="inline"><summary>Set a budget</summary><form action={budgetAction} className="stack"><Field label="Programme"><select name="programme"><option value="REFERRAL">Referral</option><option value="VACANCY">Vacancy</option></select></Field><Field label="Month"><input name="month" required defaultValue={month} pattern="\d{4}-\d{2}" /></Field><Field label="Limit (naira)"><input name="limit" required inputMode="decimal" /></Field><button className="btn primary" type="submit">Save budget</button></form></details>
      </section>

      <section className="card"><h2>Thresholds</h2>
        <details className="inline"><summary>Change limits</summary>
          <form action={settingsAction} className="stack">
            <Field label="Smallest payout (naira)"><input name="payoutThreshold" required defaultValue={(settings.payoutThresholdKobo / 100).toString()} inputMode="decimal" /></Field>
            <Field label="Sign-ups per referrer per day before a check"><input name="referralBurstPerDay" required defaultValue={settings.referralBurstPerDay} inputMode="numeric" /></Field>
            <Field label="Vacancy reports per person per day before a check"><input name="vacancyReportsPerDay" required defaultValue={settings.vacancyReportsPerDay} inputMode="numeric" /></Field>
            <Field label="Rejected reports before a check"><input name="vacancyRejectFlag" required defaultValue={settings.vacancyRejectFlag} inputMode="numeric" /></Field>
            <Field label="Duplicate radius (metres)"><input name="duplicateRadiusM" required defaultValue={settings.duplicateRadiusM} inputMode="numeric" /></Field>
            <Field label="Duplicate window (days)"><input name="duplicateWindowDays" required defaultValue={settings.duplicateWindowDays} inputMode="numeric" /></Field>
            <button className="btn primary" type="submit">Save limits</button>
          </form></details>
      </section>

      <section className="card"><h2>Reconciliation</h2>
        <p className="small">Payments verified: {formatKobo(rec.paidOutKobo)} · Rewards marked paid: {formatKobo(rec.paidRewardsKobo)}</p>
        {rec.findings.length === 0 ? <p className="muted">Payments, rewards and the ledger agree.</p> : <ul className="timeline">{rec.findings.map((f) => <li key={f.code}><strong>{f.message}</strong><div className="small muted">{f.refs.join(", ")}</div></li>)}</ul>}
      </section>
    </div>
  );
}
