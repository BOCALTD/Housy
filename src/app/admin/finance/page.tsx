import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { ACCOUNTS, LEDGERS, balances, entries, reconcileFinance } from "@/lib/services/finance";
import { formatKobo } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import SaveDocument from "@/components/SaveDocument";
import { adjustAction } from "./actions";

export const metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function AdminFinancePage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const ledger = (LEDGERS as readonly string[]).includes(sp(searchParams, "ledger") ?? "") ? sp(searchParams, "ledger")! : "";
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const check = sp(searchParams, "check") === "1";
  const [bal, list, rec] = await Promise.all([balances(admin.id), entries(admin.id, { ledger, page }), check ? reconcileFinance(admin.id) : Promise.resolve(null)]);
  const q = (p: number) => `/admin/finance?${ledger ? `ledger=${ledger}&` : ""}page=${p}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Finance</h1><p className="muted">The platform&apos;s own books for subscriptions and advertising. Every entry comes from a verified payment message or a named person. Commissions are in each company&apos;s books; referral and vacancy rewards are on the <Link href="/admin/rewards">rewards pages</Link>. <Link href="/admin/payments">Payments</Link> · <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stack" aria-label="Balances">
        {bal.map((b) => (
          <div className="card stack" key={b.ledger}>
            <h2>{humanize(b.ledger)}</h2>
            <div className="stats">{b.accounts.map((a) => <div className="stat" key={a.account}><b>{formatKobo(a.kobo)}</b><span>{humanize(a.account)}</span></div>)}</div>
          </div>
        ))}
        <p className="small muted">Revenue is earned. Funds held is advert budget paid but not yet spent. Suspense is money received that is waiting for a decision.</p>
      </section>
      <section className="card stack" aria-label="Reconciliation">
        <h2>Reconciliation</h2>
        {rec ? (rec.balanced ? <p><Pill status="ACTIVE" label="Balanced" /> Invoices, payments, refunds, adverts and the ledger agree.</p> : (
          <ul className="stack">{rec.findings.map((f) => <li key={f.code}><b>{humanize(f.code)}</b> <span className="muted">{f.message}</span><details className="inline"><summary>{f.refs.length || "See"} reference{f.refs.length === 1 ? "" : "s"}</summary><p className="small">{f.refs.join(", ") || "Totals only."}</p></details></li>)}</ul>
        )) : <p className="muted">Run the check to compare payments, refunds, adverts and the ledger.</p>}
        <div className="row"><Link className="btn" href="/admin/finance?check=1">Run the check</Link></div>
      </section>
      <section className="card stack" aria-label="Entries">
        <h2>Entries</h2>
        <div className="row">{["", ...LEDGERS].map((l) => <Link key={l || "all"} className={`btn${l === ledger ? " primary" : ""}`} href={l ? `/admin/finance?ledger=${l}` : "/admin/finance"}>{l ? humanize(l) : "All"}</Link>)}</div>
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Ledger</th><th>Account</th><th>Kind</th><th>Amount</th><th>Why</th></tr></thead><tbody>
          {list.rows.map((e) => <tr key={e.id}><td>{formatDateTime(e.createdAt)}</td><td>{humanize(e.ledger)}</td><td>{humanize(e.account)}</td><td>{humanize(e.kind)}</td><td>{formatKobo(e.amountKobo)}</td><td>{e.note ? <details className="inline"><summary>Note</summary><p className="small">{e.note}</p></details> : <span className="muted">{e.eventId ? "Verified" : "Authorised"}</span>}</td></tr>)}
          {list.rows.length === 0 && <tr><td colSpan={6} className="muted">No entries yet.</td></tr>}
        </tbody></table></div>
        <div className="row between">{page > 0 ? <Link className="btn" href={q(page - 1)}>Previous</Link> : <span />}{(page + 1) * list.pageSize < list.total ? <Link className="btn" href={q(page + 1)}>Next</Link> : <span />}</div>
        <div className="row"><SaveDocument url={`/admin/finance/export${ledger ? `?ledger=${ledger}` : ""}`} fallbackName="finance-ledger.csv" label="Save the ledger" /></div>
      </section>
      <section className="card stack" aria-label="Correction">
        <details className="inline"><summary>Enter a correction</summary>
          <form action={adjustAction} className="stack">
            <p className="small muted">Adds a new entry in your name. Nothing already written is changed. Use a minus sign to take money out.</p>
            <Field label="Ledger"><select name="ledger">{LEDGERS.map((l) => <option key={l} value={l}>{humanize(l)}</option>)}</select></Field>
            <Field label="Account"><select name="account">{ACCOUNTS.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</select></Field>
            <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" /></Field>
            <Field label="Reason"><input name="note" required minLength={5} maxLength={300} /></Field>
            <button className="btn" type="submit">Enter correction</button>
          </form></details>
      </section>
    </div>
  );
}
