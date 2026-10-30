import Link from "next/link";
import SaveDocument from "@/components/SaveDocument";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingJournal } from "@/lib/services/accounting";
import { ACCOUNTS, ACCOUNT_HELP, type AccountKey } from "@/lib/accounting-rules";
import { formatKobo } from "@/lib/money";
import { todayInLagos, toDateOnlyString } from "@/lib/dates";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { saveCodesAction } from "./actions";

export const metadata = { title: "Accounting export" };
export const dynamic = "force-dynamic";

export default async function AccountingPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("finance.view");
  const today = todayInLagos();
  // The year so far, unless a period is chosen.
  const from = sp(searchParams, "from") ?? `${today.getUTCFullYear()}-01-01`;
  const to = sp(searchParams, "to") ?? toDateOnlyString(today);
  let problem: string | undefined;
  let j: Awaited<ReturnType<typeof accountingJournal>> | null = null;
  try { j = await accountingJournal(member, from, to); } catch (e) { problem = e instanceof Error ? e.message : "Could not build the journal"; }
  const keys = Object.keys(ACCOUNTS) as AccountKey[];
  const code = (k: AccountKey) => j?.codes[k] || ACCOUNTS[k].code;
  const moved = j ? keys.filter((k) => j!.totals.has(k)) : [];
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Accounting export</h1>
        <p className="muted">Your rent, deposit and service charge records for a period as balanced journals, to import into your accounting package (QuickBooks, Sage, Xero, Zoho Books or a spreadsheet). The platform keeps the records; your accounting package remains your books of account.</p>
        <p className="row"><Link className="btn" href="/app/reports">Rent reports</Link></p>
      </div>
      <Flash searchParams={{ error: problem ?? sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <form className="row" aria-label="Export period">
        <Field label="From"><input name="from" type="date" defaultValue={from} required /></Field>
        <Field label="To"><input name="to" type="date" defaultValue={to} required /></Field>
        <button className="btn" type="submit">Update</button>
      </form>

      {j ? (
        <section className="card stack" aria-labelledby="mv-h">
          <div className="row between">
            <h2 id="mv-h">Movement on each account</h2>
            <span className="small muted">{j.entries.length} journal{j.entries.length === 1 ? "" : "s"} · {from} to {to}</span>
          </div>
          {j.entries.length === 0 ? <p className="muted">Nothing was billed, received, adjusted or spent in this period.</p> : (
            <>
              <div className="table-wrap">
                <table className="stack-table">
                  <thead><tr><th>Code</th><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                  <tbody>{moved.map((k) => { const t = j!.totals.get(k)!; return (
                    <tr key={k}><td data-label="Code" className="mono">{code(k)}</td><td data-label="Account">{ACCOUNTS[k].name}</td><td data-label="Debit" className="r">{t.debit ? formatKobo(t.debit) : "–"}</td><td data-label="Credit" className="r">{t.credit ? formatKobo(t.credit) : "–"}</td></tr>
                  ); })}</tbody>
                </table>
              </div>
              <p className="small muted">Every journal balances. Rent on properties you manage for owners goes to “{ACCOUNTS.OWNER_RENT.name}”, and service charge to the tenants’ fund, not to income.</p>
              <div className="row">
                <SaveDocument url={`/app/reports/journal.csv?${q}`} fallbackName={`journal-${from}-to-${to}.csv`} label="Download (debit and credit columns)" />
                <SaveDocument url={`/app/reports/journal.csv?${q}&layout=signed`} fallbackName={`journal-${from}-to-${to}-signed.csv`} label="Download (one amount column)" />
              </div>
              <details className="inline"><summary>What is included and when</summary>
                <ul className="small">
                  <li>Rent billed on its due date; approved late fees, waivers, credit notes and corrections on the day they were approved.</li>
                  <li>Receipts on the day paid, against what the tenant owes (an opening balance paid ahead of billing is held as a payment in advance). A reversed receipt is reversed on the day it was reversed.</li>
                  <li>Deposits received, deducted and refunded on their entry dates.</li>
                  <li>Service charge billed on its due date, collected on the day paid, and approved spending on the day incurred (to accounts payable, to be paid from your bank in your accounting package).</li>
                  <li>Downloads are recorded in your activity log. Check the export against your bank statements before posting.</li>
                </ul>
              </details>
            </>
          )}
        </section>
      ) : null}

      <details className="card fold-card">
        <summary><h2>Your account codes</h2><span className="small muted">{keys.filter((k) => j?.codes[k]).length ? `${keys.filter((k) => j?.codes[k]).length} of ${keys.length} set` : "Using the defaults"}</span></summary>
        <p className="small muted">Use the codes from your own chart of accounts so the import lands in the right place. Leave a code blank to use the one shown.</p>
        {can(member.role, "settings.manage") ? (
          <form action={saveCodesAction} className="stack">
            <div className="codes-grid">
              {keys.map((k) => (
                <label key={k} className="field"><span>{ACCOUNTS[k].name}</span>
                  <input name={k} defaultValue={j?.codes[k] ?? ""} placeholder={ACCOUNTS[k].code} maxLength={30} autoComplete="off" />
                  <small className="muted">{ACCOUNT_HELP[k]}</small>
                </label>
              ))}
            </div>
            <div className="row"><button className="btn primary" type="submit">Save codes</button></div>
          </form>
        ) : (
          <ul className="small">{keys.map((k) => <li key={k}><span className="mono">{code(k)}</span> {ACCOUNTS[k].name}</li>)}</ul>
        )}
      </details>
    </div>
  );
}
