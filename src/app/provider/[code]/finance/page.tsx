import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { providerFinance } from "@/lib/services/verification-finance";
import { EARNING_WORDS, maskAccount, PAYOUT_WAIT_DAYS, type EarningStatus } from "@/lib/verification-finance-rules";
import { vpCan } from "@/lib/verification-network-rules";
import { day, naira } from "@/app/verification/case-ui";
import { OrgHeader, orgFor } from "../shared";
import { payoutDetailsAction } from "./actions";
import { COUNTRIES, COUNTRY_CODES, bankFieldsFor, countryName, isCountry } from "@/lib/regions";

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
  const chosen = sp(searchParams, "bankCountry") ?? "";
  const bankCountry = isCountry(chosen) ? chosen : isCountry(f.account.country) ? f.account.country : "NG";
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
        {f.account.complete ? (
          <dl className="stack" style={{ gap: 4, margin: 0 }}>
            <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}><dt className="small muted">Country</dt><dd className="small" style={{ margin: 0 }}>{countryName(f.account.country)}</dd></div>
            {(f.account.lines.length ? f.account.lines : [{ label: "Bank", value: f.account.bankName }, { label: "Account name", value: f.account.accountName }, { label: "Account number", value: f.account.accountNumber }]).map((l) => <div key={l.label} className="row between" style={{ flexWrap: "wrap", gap: 8 }}><dt className="small muted">{l.label}</dt><dd className="small mono" style={{ margin: 0, overflowWrap: "anywhere" }}>{l.value}</dd></div>)}
            {f.account.updatedAt ? <p className="small muted">Changed {day(f.account.updatedAt)}</p> : null}
          </dl>
        ) : <p className="warn-text">No complete bank account yet. Housy cannot pay you until one is recorded.</p>}
        {manage ? (
          <details className="vp-fold" open={!f.account.complete || !!sp(searchParams, "bankCountry")}><summary>{f.account.complete ? "Change the account" : "Add the account"}</summary>
            <form method="get" className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Country of the bank account"><select name="bankCountry" defaultValue={bankCountry}>{COUNTRY_CODES.map((c) => <option key={c} value={c}>{COUNTRIES[c].name}</option>)}</select></Field>
              <button className="btn" type="submit">Show the fields</button>
            </form>
            <form action={payoutDetailsAction} className="stack">
              <input type="hidden" name="code" value={ctx.code} />
              <input type="hidden" name="country" value={bankCountry} />
              <div className="fields">
                {bankFieldsFor(bankCountry).map((fl) => (
                  <Field key={fl.key} label={fl.label} hint={fl.hint}><input name={fl.key} required={!/optional/i.test(fl.hint ?? "")} inputMode={fl.numeric ? "numeric" : undefined} autoComplete="off" defaultValue={bankCountry === f.account.country && !/number|iban/i.test(fl.key) ? f.account.details?.[fl.key] ?? (fl.key === "bankName" ? f.account.bankName : fl.key === "accountName" ? f.account.accountName : "") : ""} /></Field>
                ))}
              </div>
              <p className="small muted">Use the organisation&apos;s own corporate account. Earnings are in naira; for an account outside Nigeria, Housy converts when it pays. Everyone in your organisation who handles money is told whenever it changes.</p>
              <div className="row"><button className="btn" type="submit" data-confirm="Change where Housy pays you?" data-confirm-body="Future payouts go to this account. Check the details carefully." data-confirm-ok="Save account" data-confirm-tone="default">Save</button></div>
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
