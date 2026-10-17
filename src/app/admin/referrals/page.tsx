import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminReferrals } from "@/lib/services/referrals";
import { PROGRAMME_EVENTS, EVENT_LABELS } from "@/lib/services/rewards";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { campaignAction, customEventAction, endCampaignAction, reviewAction } from "./actions";

export const metadata = { title: "Referrals" };
export const dynamic = "force-dynamic";
const AUDIENCES = ["SEEKER", "OWNER", "AGENT", "COMPANY", "DEVELOPER", "VENDOR", "SUBSCRIBER", "LISTING", "OTHER"];

export default async function AdminReferralsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const state = sp(searchParams, "show") === "all" ? "ALL" : "FLAGGED";
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const d = await adminReferrals(admin.id, state, page);
  const total = Object.values(d.stats.byStatus).reduce((s, n) => s + n, 0);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Referrals</h1><p className="muted">A warning sign is a reason to look, never a verdict. Nothing here accuses anyone on one signal. <Link href="/admin/rewards">Rewards</Link> · <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{d.stats.clicks}</b><span>Link visits ({d.stats.codes} codes)</span></div>
        <div className="stat"><b>{total}</b><span>Sign-ups</span></div>
        <div className="stat"><b>{d.stats.byStatus.QUALIFIED ?? 0}</b><span>Qualified</span></div>
        <div className="stat"><b>{d.stats.byReview.FLAGGED ?? 0}</b><span>To check</span></div>
      </section>
      <section className="card"><h2>{state === "FLAGGED" ? "To check" : "All referrals"}</h2>
        <div className="row"><Link className={`btn${state === "FLAGGED" ? " primary" : ""}`} href="/admin/referrals">To check</Link><Link className={`btn${state === "ALL" ? " primary" : ""}`} href="/admin/referrals?show=all">All</Link></div>
        {d.items.length === 0 ? <p className="muted">Nothing here.</p> : (
          <ul className="timeline">{d.items.map((a) => (
            <li key={a.id}><div className="row between"><span><strong>{a.referrerName}</strong> referred <strong>{a.referredName}</strong> <span className="small muted">{a.ref} · {formatDate(a.registeredAt)}</span></span><Pill status={a.status} /></div>
              <div className="small muted">{a.referrerEmail} → {a.referredEmail} · {humanize(a.reviewState)}</div>
              {a.signalText.length ? <ul className="small">{a.signalText.map((t) => <li key={t}>{t}</li>)}</ul> : null}
              {a.reviewState === "FLAGGED" ? (
                <details className="inline"><summary>Decide</summary><form action={reviewAction} className="stack"><input type="hidden" name="attributionId" value={a.id} /><Field label="What you found"><input name="note" required minLength={5} maxLength={500} /></Field><div className="row"><button className="btn primary" type="submit" name="decision" value="clear">Looks genuine</button><button className="btn" type="submit" name="decision" value="reject">Not genuine</button></div></form></details>
              ) : a.reviewNote ? <div className="small muted">{a.reviewNote}</div> : null}
              {a.status === "REGISTERED" ? <details className="inline"><summary>Record a custom event</summary><form action={customEventAction} className="row"><input type="hidden" name="attributionId" value={a.id} /><input name="note" required minLength={5} placeholder="What happened" aria-label="What happened" /><button className="btn" type="submit">Record</button></form></details> : null}
            </li>))}</ul>
        )}
        <div className="row">{page > 1 ? <Link className="btn" href={`/admin/referrals?show=${state === "ALL" ? "all" : "flagged"}&page=${page - 1}`}>Previous</Link> : null}{d.more ? <Link className="btn" href={`/admin/referrals?show=${state === "ALL" ? "all" : "flagged"}&page=${page + 1}`}>Next</Link> : null}</div>
      </section>
      <section className="card"><h2>Campaigns</h2>
        {d.campaigns.length === 0 ? <p className="muted">No campaigns yet. Create one, then set its reward on the rewards page.</p> : (
          <ShowMore noun="more campaigns" limit={4} items={d.campaigns.map((c) => <li key={c.id}><div className="row between"><span><strong>{c.name}</strong> <span className="small muted">{humanize(c.audience)} · {EVENT_LABELS[c.event]} · {c.registered} sign-ups, {c.qualified} qualified · {formatDate(c.startsOn)}{c.endsOn ? ` to ${formatDate(c.endsOn)}` : ""}{c.active ? "" : " · ended"}</span></span>{c.active ? <form action={endCampaignAction}><input type="hidden" name="campaignId" value={c.id} /><button className="btn" type="submit">End</button></form> : null}</div></li>)} />
        )}
        <details className="inline"><summary>New campaign</summary>
          <form action={campaignAction} className="stack">
            <Field label="Name"><input name="name" required minLength={3} maxLength={120} /></Field>
            <Field label="Who can be referred"><select name="audience">{AUDIENCES.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</select></Field>
            <Field label="What earns the reward"><select name="event">{PROGRAMME_EVENTS.REFERRAL.map((e) => <option key={e} value={e}>{EVENT_LABELS[e]}</option>)}</select></Field>
            <Field label="Description"><textarea name="description" rows={2} maxLength={1000} /></Field>
            <Field label="Starts"><input type="date" name="startsOn" required /></Field>
            <Field label="Ends" hint="Optional."><input type="date" name="endsOn" /></Field>
            <Field label="Link stays valid (days after a visit)"><input name="attributionDays" required defaultValue="30" inputMode="numeric" /></Field>
            <Field label="Must qualify within (days of sign-up)"><input name="qualifyWithinDays" required defaultValue="60" inputMode="numeric" /></Field>
            <Field label="Most rewards per referrer" hint="Optional."><input name="maxRewardsPerReferrer" inputMode="numeric" /></Field>
            <button className="btn primary" type="submit">Create campaign</button>
          </form></details>
      </section>
      <section className="card"><h2>Referral rewards</h2>
        {d.stats.rewards.length === 0 ? <p className="muted">None yet.</p> : <ul className="timeline">{d.stats.rewards.map((r) => <li key={r.status}><span className="small">{humanize(r.status)}: {r.count} · {formatKobo(r.kobo)}</span></li>)}</ul>}
      </section>
    </div>
  );
}
