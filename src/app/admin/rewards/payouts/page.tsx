import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminPayouts, readRewardSettings } from "@/lib/services/rewards";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createPayoutAction, failPayoutAction, verifyPayoutAction } from "../actions";

export const metadata = { title: "Reward payouts" };
export const dynamic = "force-dynamic";

export default async function PayoutsPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const [{ payouts, owed }, settings] = await Promise.all([adminPayouts(admin.id), readRewardSettings()]);
  const pending = payouts.filter((p) => p.status === "PENDING");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Reward payouts</h1><p className="muted">Money is sent outside this platform. One administrator creates a payout; a different one confirms it with the bank reference, and only then are the rewards marked paid. <Link href="/admin/rewards">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card"><h2>Owed</h2>
        <p className="small muted">Payable balances of at least {formatKobo(BigInt(settings.payoutThresholdKobo))}. The safety period has passed and the source has been checked again.</p>
        {owed.length === 0 ? <p className="muted">Nothing is waiting to be paid.</p> : (
          <ShowMore noun="more people" limit={5} items={owed.map((o) => <li key={o.userId}><div className="row between"><span><strong>{o.name}</strong> <span className="small muted">{formatKobo(o.kobo)}</span></span>
            <form action={createPayoutAction} className="row"><input type="hidden" name="userId" value={o.userId} /><button className="btn" type="submit">Create payout</button></form></div></li>)} />
        )}
      </section>
      <section className="card"><h2>Waiting for verification ({pending.length})</h2>
        {pending.length === 0 ? <p className="muted">None.</p> : (
          <ul className="timeline">{pending.map((p) => (
            <li key={p.id}><div className="row between"><span><strong>{p.userName}</strong> <span className="small muted">{p.ref} · {formatKobo(p.amountKobo)} · created by {p.createdByName}, {formatDate(p.createdAt)}</span></span><Pill status={p.status} /></div>
              {p.createdById === admin.id ? <p className="small muted">You created this. A different administrator must verify it.</p> : (
                <details className="inline"><summary>I sent the money</summary><form action={verifyPayoutAction} className="stack"><input type="hidden" name="payoutId" value={p.id} /><Field label="Bank or transfer reference"><input name="reference" required minLength={4} maxLength={120} /></Field><button className="btn primary" type="submit">Confirm payment</button></form></details>
              )}
              <details className="inline"><summary>The payment failed</summary><form action={failPayoutAction} className="stack"><input type="hidden" name="payoutId" value={p.id} /><Field label="What went wrong"><input name="reason" required minLength={5} maxLength={500} /></Field><button className="btn" type="submit">Mark as failed</button></form></details>
            </li>))}</ul>
        )}
      </section>
      <section className="card"><h2>History</h2>
        {payouts.filter((p) => p.status !== "PENDING").length === 0 ? <p className="muted">No payouts yet.</p> : (
          <ShowMore noun="more payouts" limit={6} items={payouts.filter((p) => p.status !== "PENDING").map((p) => <li key={p.id}><div className="row between"><span><strong>{p.userName}</strong> <span className="small muted">{p.ref} · {formatKobo(p.amountKobo)} · {formatDate(p.createdAt)}</span></span><Pill status={p.status} /></div><div className="small muted">{p.status === "PAID" ? `Reference ${p.reference}` : p.failureReason}</div></li>)} />
        )}
      </section>
    </div>
  );
}
