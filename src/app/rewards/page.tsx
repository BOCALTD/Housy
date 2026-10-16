import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myRewards } from "@/lib/services/rewards";
import { rewardExplainer, type RewardStatusName } from "@/lib/reward-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import SaveDocument from "@/components/SaveDocument";
import { disputeRewardAction } from "./actions";

export const metadata = { title: "My rewards" };
export const dynamic = "force-dynamic";

export default async function RewardsPage({ searchParams }: { searchParams?: SP }) {
  const user = await requireUser();
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const r = await myRewards(user.id, page);
  const sum = (...s: string[]) => s.reduce((t, k) => t + (r.by[k]?.kobo ?? 0n), 0n);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>My rewards</h1><p className="muted">Every reward shows why it is where it is. <Link href="/referrals">Refer and earn</Link> · <Link href="/vacancies">Report a vacancy</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {r.restricted ? <div className="flash error" role="status">Rewards are paused on your account: {r.restricted}</div> : null}
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{formatKobo(sum("ELIGIBLE", "UNDER_REVIEW"))}</b><span>Pending</span></div>
        <div className="stat"><b>{formatKobo(sum("APPROVED", "PAYABLE"))}</b><span>Approved</span></div>
        <div className="stat"><b>{formatKobo(sum("PAID"))}</b><span>Paid</span></div>
      </section>
      <section className="card"><div className="row between"><h2>Rewards</h2><SaveDocument url="/rewards/export" fallbackName="my-rewards.csv" /></div>
        {r.items.length === 0 ? <p className="muted">No rewards yet.</p> : (
          <ul className="timeline">{r.items.map((w) => {
            const d = r.disputes.get(w.id);
            return <li key={w.id}><div className="row between"><strong>{w.sourceLabel || humanize(w.event)}</strong><Pill status={w.status} /></div>
              <div className="small muted">{w.ref} · {formatKobo(w.amountKobo)} · {formatDate(w.createdAt)}{w.policyVersion ? ` · terms v${w.policyVersion}` : ""}</div>
              <div className="small">{rewardExplainer(w.status as RewardStatusName, { payableAt: w.payableAt, reason: w.reason })}</div>
              <details className="inline"><summary>History</summary><ul className="timeline">{w.ledger.map((l) => <li key={l.id}><span className="small">{formatDateTime(l.createdAt)} · {humanize(l.toStatus)} · {l.actorName}</span><div className="small muted">{l.note}</div></li>)}</ul></details>
              {["REJECTED", "NOT_ELIGIBLE"].includes(w.status) && !d ? (
                <details className="inline"><summary>Dispute this</summary><form action={disputeRewardAction} className="stack"><input type="hidden" name="rewardId" value={w.id} /><Field label="Why do you disagree?"><textarea name="reason" required minLength={10} maxLength={1000} rows={3} /></Field><button className="btn" type="submit">Send dispute</button></form></details>
              ) : null}
              {d ? <div className="small muted">Dispute: {humanize(d.status)}{d.resolution ? `. ${d.resolution}` : ""}</div> : null}
            </li>;
          })}</ul>
        )}
        <div className="row">{page > 1 ? <Link className="btn" href={`/rewards?page=${page - 1}`}>Previous</Link> : null}{r.more ? <Link className="btn" href={`/rewards?page=${page + 1}`}>Next</Link> : null}</div>
      </section>
      <section className="card"><h2>Payments</h2>
        {r.payouts.length === 0 ? <p className="muted">No payments yet.</p> : (
          <ShowMore noun="more payments" limit={3} items={r.payouts.map((p) => <li key={p.id}><div className="row between"><span><strong>{formatKobo(p.amountKobo)}</strong> <span className="small muted">{p.ref} · {formatDate(p.createdAt)}</span></span><Pill status={p.status} /></div>{p.status === "PAID" ? <div className="small muted">Reference {p.reference}</div> : null}{p.status === "FAILED" ? <div className="small">{p.failureReason}. The reward is payable again.</div> : null}</li>)} />
        )}
      </section>
    </div>
  );
}
