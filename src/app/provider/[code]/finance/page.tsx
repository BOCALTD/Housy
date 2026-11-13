import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { providerFinance } from "@/lib/services/verification-finance";
import { EARNING_WORDS, maskAccount, PAYOUT_WAIT_DAYS, type EarningStatus } from "@/lib/verification-finance-rules";
import { vpCan } from "@/lib/verification-network-rules";
import { day, naira } from "@/app/verification/case-ui";
import { OrgHeader, orgFor } from "../shared";
import { payoutDetailsAction } from "./actions";

export const metadata = { title: "Earnings and payouts", robots: { index: false } };
export const dynamic = "force-dynamic";

const PAGE = 20;

export default async function ProviderFinance({ params: p, searchParams: s }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const { code } = await p;
  const searchParams = await s;
  const ctx = await orgFor(code);
  if (!vpCan(ctx.role, "finance.view")) {
    return <div className="wrap stack-lg vp"><OrgHeader ctx={ctx} title="Earnings and payouts" /><div className="card"><p>Only the organisation&apos;s owner and finance staff see its money.</p></div></div>;
  }
  const f = await providerFinance(ctx);
  const page = Math.max(1, Number(sp(searchParams, "page") || 1));
  const shown = f.earnings.slice((page - 1) * PAGE, page * PAGE);
  const manage = vpCan(ctx.role, "finance.manage");
  const tile = (kobo: bigint, label: string) => <div className="card"><span className="vp-stat">{naira(kobo)}</span><span className="small muted">{label}</span></div>;
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} title="Earnings and payouts" />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <p className="small muted">For each delivered case you earn the price Housy quoted the customer less Housy&apos;s fee, both shown on the case before you accept it. It becomes ready to pay when the customer confirms the report, or {PAYOUT_WAIT_DAYS} days after delivery without a dispute. Housy pays by bank transfer to the account below and records the transfer reference.</p>
      <section className="vp-stats" aria-label="Your money at a glance">
        {tile(f.totals.pending, "Waiting for the customer")}
        {tile(f.totals.held, "Held (disputed)")}
        {tile(f.totals.payable, "Ready to pay")}
        {tile(f.totals.inPayout, "In a payout")}
        {tile(f.totals.paid, "Paid to you")}
      </section>

      <section className="card stack">
        <h2>Payout bank account</h2>
        {f.account.complete ? <p>{f.account.bankName} · {f.account.accountName} · <span className="mono">{f.account.accountNumber}</span>{f.account.updatedAt ? <span className="small muted"> · changed {day(f.account.updatedAt)}</span> : null}</p> : <p className="warn-text">No complete bank account yet. Housy cannot pay you until one is recorded.</p>}
        {manage ? (
          <details className="vp-fold" open={!f.account.complete}><summary>{f.account.complete ? "Change the account" : "Add the account"}</summary>
            <form action={payoutDetailsAction} className="stack">
              <input type="hidden" name="code" value={ctx.code} />
              <div className="grid-3">
                <Field label="Bank"><input name="bankName" required maxLength={80} defaultValue={f.account.bankName} /></Field>
                <Field label="Account name" hint="Exactly as the bank shows it"><input name="accountName" required maxLength={120} defaultValue={f.account.accountName} /></Field>
                <Field label="Account number" hint="10-digit NUBAN"><input name="accountNumber" required inputMode="numeric" pattern="[0-9 ]{10,13}" maxLength={13} autoComplete="off" /></Field>
              </div>
              <p className="small muted">Use the organisation&apos;s own corporate account. Everyone in your organisation who handles money is told whenever it changes.</p>
              <div className="row"><button className="btn" type="submit" data-confirm="Change where Housy pays you?" data-confirm-body="Future payouts go to this account. Check the number carefully." data-confirm-ok="Save account" data-confirm-tone="default">Save</button></div>
            </form>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2>Earnings ({f.earnings.length})</h2>
          {f.earnings.length ? <a className="btn small" href={`/provider/${ctx.code}/finance/statement`}>Download statement (CSV)</a> : null}
        </div>
        {shown.length === 0 ? <p className="muted small">No earnings yet. They appear when a report you wrote is delivered.</p> : (
          <ul className="vp-list">{shown.map((e) => (
            <li key={e.id}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong><Link href={`/provider/cases/${e.caseRef}`}>{e.caseRef}</Link> · {naira(e.netKobo)}</strong>
                <span className="small muted">{e.property} · price {naira(e.grossKobo)}, Housy&apos;s fee {naira(e.feeKobo)}{e.status === "PENDING" && e.payableFrom ? ` · ready from ${day(e.payableFrom)}` : ""}{e.heldReason ? ` · ${e.heldReason}` : ""}{e.paidAt ? ` · paid ${day(e.paidAt)}` : ""}</span>
              </span>
              <span className={`pill ${e.status === "PAID" ? "ok" : e.status === "HELD" ? "warn" : e.status === "VOID" ? "bad" : ""}`}>{EARNING_WORDS[e.status as EarningStatus]}</span>
            </li>
          ))}</ul>
        )}
        {f.earnings.length > PAGE ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            {page > 1 ? <Link className="btn small" href={`?page=${page - 1}`}>Newer</Link> : <span />}
            {page * PAGE < f.earnings.length ? <Link className="btn small" href={`?page=${page + 1}`}>Older</Link> : null}
          </div>
        ) : null}
      </section>

      <details className="card vp-fold">
        <summary>Payouts ({f.payouts.length})</summary>
        {f.payouts.length ? <ul className="vp-list">{f.payouts.map((p) => (
          <li key={p.id}><span className="stack" style={{ gap: 2, minWidth: 0 }}><strong>{p.ref} · {naira(p.totalKobo)}</strong>
            <span className="small muted">{p.status === "PAID" ? `Paid ${day(p.paidAt)} · transfer ${p.transferReference}` : p.status === "PREPARED" ? `Prepared ${day(p.preparedAt)}; Housy will record the transfer` : `Cancelled: ${p.cancelReason}`} · {p.bankName} {maskAccount(p.accountNumber)}</span></span>
            <span className={`pill ${p.status === "PAID" ? "ok" : ""}`}>{p.status.toLowerCase()}</span></li>
        ))}</ul> : <p className="muted small">None yet.</p>}
      </details>
    </div>
  );
}
