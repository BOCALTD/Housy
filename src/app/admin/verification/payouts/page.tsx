import { requestTimeZone } from "@/lib/money-context";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { payoutOverview } from "@/lib/services/verification-finance";
import { maskAccount } from "@/lib/verification-finance-rules";
import { day, naira } from "@/app/verification/case-ui";
import { cancelPayoutAction, heldEarningAction, markPaidAction, preparePayoutAction } from "./actions";

export const metadata = { title: "Verification payouts" };
export const dynamic = "force-dynamic";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: requestTimeZone() });

export default async function Payouts({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const o = await payoutOverview(admin.id);
  const prepared = o.payouts.filter((p) => p.status === "PREPARED");
  const history = o.payouts.filter((p) => p.status !== "PREPARED");
  return (
    <div className="stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin/verification">Verification network</Link>
        <h1>Verification payouts</h1>
        <p className="muted">What Housy owes each provider for delivered cases (its share after Housy&apos;s fee). Housy does not send money automatically: prepare a payout, make the transfer from Housy&apos;s bank, then record the transfer reference here. A paid payout can never be changed.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {prepared.length ? (
        <section className="card stack vp-ask">
          <h2>Prepared: make these transfers ({prepared.length})</h2>
          <ul className="vp-list">{prepared.map((p) => (
            <li key={p.id} className="stack" style={{ alignItems: "stretch" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <span className="stack" style={{ gap: 2, minWidth: 0 }}><strong>{p.ref} · {p.providerName} · {naira(p.totalKobo)}</strong>
                  <span className="small">To {p.bankName}, {p.accountName}, account <span className="mono">{p.accountNumber}</span>{p.currency !== "NGN" ? <> · an account in {p.currency}: convert when you pay</> : null}</span>
                  <span className="small muted">Prepared {day(p.preparedAt)}</span></span>
              </div>
              <div className="grid-2">
                <form action={markPaidAction} className="stack">
                  <input type="hidden" name="ref" value={p.ref} />
                  <div className="grid-2">
                    <Field label="Transfer reference"><input name="reference" required minLength={3} maxLength={80} /></Field>
                    <Field label="Paid on"><input type="date" name="paidOn" required defaultValue={today()} max={today()} /></Field>
                    {p.currency !== "NGN" ? <Field label={`Amount sent (${p.currency})`} hint="As the bank transfer shows it. The rate is worked out and shown to the organisation."><input name="sent" required inputMode="decimal" /></Field> : null}
                  </div>
                  <button className="btn primary" type="submit" data-confirm={`Record ${p.ref} as paid?`} data-confirm-body={`Only after ${naira(p.totalKobo)} has actually left Housy's bank for ${p.bankName} ${maskAccount(p.accountNumber)}. This cannot be undone.`} data-confirm-ok="Record as paid" data-confirm-tone="default">Record as paid</button>
                </form>
                <details className="vp-fold"><summary>Cancel this payout</summary>
                  <form action={cancelPayoutAction} className="stack">
                    <input type="hidden" name="ref" value={p.ref} />
                    <Field label="Reason"><input name="reason" required minLength={5} maxLength={500} /></Field>
                    <button className="btn" type="submit" data-confirm="Cancel this payout?" data-confirm-body="Its earnings go back to ready to pay." data-confirm-ok="Cancel payout">Cancel payout</button>
                  </form>
                </details>
              </div>
            </li>
          ))}</ul>
        </section>
      ) : null}

      <section className="card stack">
        <h2>Ready to pay</h2>
        {o.payable.length === 0 ? <p className="muted small">Nothing is owed to providers just now. Earnings become payable when the customer confirms the report, or 7 days after delivery without a dispute.</p> : (
          <ul className="vp-list">{o.payable.map((p) => (
            <li key={p.providerId}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}><strong>{p.name} · {naira(p.totalKobo)}</strong>
                <span className="small muted">{p.count} case{p.count === 1 ? "" : "s"} · {p.account ?? "No complete bank account recorded yet"}</span></span>
              <form action={preparePayoutAction}><input type="hidden" name="providerId" value={p.providerId} /><button className="btn" type="submit" disabled={!p.account}>Prepare payout</button></form>
            </li>
          ))}</ul>
        )}
      </section>

      {o.held.length ? (
        <section className="card stack">
          <h2>Held ({o.held.length})</h2>
          <p className="small muted">Held because the customer disputed the report or it was revoked. Release it once settled, or cancel it after refunding the customer.</p>
          <ul className="vp-list">{o.held.map((h) => (
            <li key={h.id} className="stack" style={{ alignItems: "stretch" }}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}><strong><Link href={`/admin/verification/cases/${h.caseRef}`}>{h.caseRef}</Link> · {h.providerName} · {naira(h.netKobo)}</strong><span className="small muted">{h.heldReason}</span></span>
              <details className="vp-fold"><summary>Decide</summary>
                <form action={heldEarningAction} className="stack">
                  <input type="hidden" name="earningId" value={h.id} />
                  <Field label="Reason"><input name="note" required minLength={5} maxLength={500} /></Field>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <button className="btn" name="decision" value="release" type="submit">Release to the provider</button>
                    <button className="btn" name="decision" value="cancel" type="submit" data-confirm="Cancel this earning?" data-confirm-body="Only after the customer has been refunded." data-confirm-ok="Cancel earning">Cancel it</button>
                  </div>
                </form>
              </details>
            </li>
          ))}</ul>
        </section>
      ) : null}

      <details className="card vp-fold">
        <summary>Payout history ({history.length})</summary>
        {history.length ? <ul className="vp-list">{history.map((p) => (
          <li key={p.id}><span className="stack" style={{ gap: 2, minWidth: 0 }}><strong>{p.ref} · {p.providerName} · {naira(p.totalKobo)}</strong>
            <span className="small muted">{p.status === "PAID" ? `Paid ${day(p.paidAt)}, transfer ${p.transferReference}, to ${p.bankName} ${maskAccount(p.accountNumber)}` : `Cancelled ${day(p.cancelledAt)}: ${p.cancelReason}`}</span></span>
            <span className={`pill ${p.status === "PAID" ? "ok" : ""}`}>{p.status.toLowerCase()}</span></li>
        ))}</ul> : <p className="muted small">None yet.</p>}
      </details>
    </div>
  );
}
