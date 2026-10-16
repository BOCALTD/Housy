import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminEvents, adminInvoices, adminPayments, readBankInstructions } from "@/lib/services/billing";
import { pendingRefunds } from "@/lib/services/refunds";
import { configuredProvider } from "@/lib/payment-providers";
import { refundable } from "@/lib/billing-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { acceptReviewAction, bankAction, cancelRefundAction, confirmRefundAction, recordOfflineAction, refundAction, voidInvoiceAction } from "./actions";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const VIEWS = ["review", "invoices", "payments", "events"] as const;
type View = (typeof VIEWS)[number];
const payTone = (s: string) => (s === "SUCCEEDED" ? "ACTIVE" : s === "FAILED" ? "SUSPENDED" : "PENDING");

export default async function AdminPaymentsPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const view: View = (VIEWS as readonly string[]).includes(sp(searchParams, "view") ?? "") ? (sp(searchParams, "view") as View) : "review";
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const provider = configuredProvider();
  const [pending, bank] = await Promise.all([pendingRefunds(admin.id), readBankInstructions()]);
  const link = (v: View, p = 0) => `/admin/payments?view=${v}&page=${p}`;
  const pager = (total: number) => (
    <div className="row between">
      {page > 0 ? <Link className="btn" href={link(view, page - 1)}>Previous</Link> : <span />}
      {(page + 1) * 20 < total ? <Link className="btn" href={link(view, page + 1)}>Next</Link> : <span />}
    </div>
  );
  const invs = view === "invoices" ? await adminInvoices(admin.id, { status: sp(searchParams, "status"), page }) : null;
  const pays = view === "payments" || view === "review" ? await adminPayments(admin.id, { status: view === "review" ? "REVIEW" : sp(searchParams, "status"), page }) : null;
  const events = view === "events" ? await adminEvents(admin.id, page) : null;
  const reviewCount = pays ? pays.review : (await adminPayments(admin.id, { status: "REVIEW" })).review;

  const refundForm = (p: NonNullable<typeof pays>["rows"][number]) => {
    const room = refundable(p);
    if ((p.status !== "SUCCEEDED" && p.status !== "REVIEW") || room <= 0n) return null;
    return (
      <details className="inline"><summary>Refund</summary>
        <form action={refundAction} className="stack">
          <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="view" value={view} />
          <Field label="Amount (₦)" hint={`Up to ${formatKobo(room)}${p.invoice.purpose === "AD_CAMPAIGN" ? ", and only budget not yet spent" : ""}.`}><input name="amount" required inputMode="decimal" defaultValue={String(Number(room) / 100)} /></Field>
          <Field label="Reason"><input name="reason" required minLength={5} maxLength={500} /></Field>
          <button className="btn" type="submit">Refund</button>
        </form></details>
    );
  };

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Payments</h1><p className="muted">Invoices, payments, refunds and the messages the payment provider sent. <Link href="/admin/finance">Ledgers and reconciliation</Link> · <Link href="/admin/plans">Plans</Link> · <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{provider ? "Connected" : "Not connected"}</b><span>Payment provider</span></div>
        <div className="stat"><b>{reviewCount}</b><span>Payments to decide</span></div>
        <div className="stat"><b>{pending.length}</b><span>Refunds waiting</span></div>
      </section>
      {!provider ? <div className="card"><p className="small">No payment provider is connected. Set <code>PAYSTACK_SECRET_KEY</code> to take online payments. Until then people pay by bank transfer and you record it under Invoices.</p></div> : null}

      {pending.length > 0 ? (
        <section className="card stack"><h2>Refunds waiting</h2>
          {pending.map((r) => (
            <div key={r.id} className="row between">
              <div><strong>{r.ref}</strong> <span className="small muted">{formatKobo(r.amountKobo)} · {r.invoice.ref} · {r.payment.provider === "MANUAL" ? "return the money, then confirm" : "with the provider"} · {r.reason}</span></div>
              <div className="row">
                <form action={confirmRefundAction}><input type="hidden" name="refundId" value={r.id} /><button className="btn" type="submit">Confirm it was refunded</button></form>
                <form action={cancelRefundAction}><input type="hidden" name="refundId" value={r.id} /><button className="btn" type="submit">Cancel</button></form>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <nav className="nav nav-scroll" aria-label="Payment views">
        {VIEWS.map((v) => <Link key={v} href={link(v)} aria-current={v === view ? "page" : undefined}>{v === "review" ? `To decide${reviewCount ? ` (${reviewCount})` : ""}` : humanize(v)}</Link>)}
      </nav>

      {view === "review" && pays ? (
        <section className="stack"><h2>Payments to decide</h2>
          <p className="small muted">These arrived but did not match the invoice, so nothing was switched on. The money is held aside until you accept or refund it.</p>
          {pays.rows.length === 0 ? <p className="muted">Nothing to decide.</p> : pays.rows.map((p) => (
            <div key={p.id} className="card stack">
              <div className="row between"><div><strong>{p.ref}</strong> <span className="small muted">{p.invoice.ref} · asked {formatKobo(p.amountKobo)} · received {p.receivedKobo ? formatKobo(p.receivedKobo) : "unknown"}</span></div><Pill status="PENDING" label="Being checked" /></div>
              <p className="small">{p.reviewNote}</p>
              <div className="row">
                {(p.receivedKobo ?? 0n) >= p.amountKobo && p.invoice.status === "OPEN" && p.refundedKobo === 0n ? (
                  <details className="inline"><summary>Accept as paid</summary>
                    <form action={acceptReviewAction} className="stack"><input type="hidden" name="paymentId" value={p.id} /><Field label="Why is this fine?"><input name="note" required minLength={5} maxLength={300} /></Field><button className="btn primary" type="submit">Accept</button></form></details>
                ) : null}
                {refundForm(p)}
              </div>
            </div>
          ))}
          {pager(pays.total)}
        </section>
      ) : null}

      {view === "invoices" && invs ? (
        <section className="stack"><h2>Invoices</h2>
          <div className="row">{["", "OPEN", "PAID", "VOID"].map((s) => <Link key={s} className="btn" href={`/admin/payments?view=invoices&status=${s}`}>{s ? humanize(s) : "All"}</Link>)}</div>
          {invs.rows.length === 0 ? <p className="muted">No invoices.</p> : invs.rows.map((i) => (
            <div key={i.id} className="card stack">
              <div className="row between"><div><strong>{i.ref}</strong> <span className="small muted">{i.ownerName} · {formatKobo(i.amountKobo)} · {formatDate(i.createdAt)}</span><div className="small">{i.description}</div></div><Pill status={i.status === "PAID" ? "ACTIVE" : i.status === "OPEN" ? "PENDING" : "SUSPENDED"} label={humanize(i.status)} /></div>
              {i.status === "OPEN" ? (
                <div className="row">
                  <details className="inline"><summary>Record a bank transfer</summary>
                    <form action={recordOfflineAction} className="stack"><input type="hidden" name="invoiceId" value={i.id} />
                      <Field label="Amount received (₦)" hint={`Must be exactly ${formatKobo(i.amountKobo)}.`}><input name="amount" required inputMode="decimal" /></Field>
                      <Field label="Bank reference" hint="Used once. The same transfer cannot be recorded twice."><input name="reference" required maxLength={80} /></Field>
                      <Field label="Note"><input name="note" maxLength={200} /></Field>
                      <button className="btn primary" type="submit">Record payment</button></form></details>
                  <details className="inline"><summary>Cancel invoice</summary>
                    <form action={voidInvoiceAction} className="stack"><input type="hidden" name="invoiceId" value={i.id} /><Field label="Reason"><input name="reason" required minLength={5} maxLength={300} /></Field><button className="btn" type="submit">Cancel invoice</button></form></details>
                </div>
              ) : null}
            </div>
          ))}
          {pager(invs.total)}
          <details className="inline"><summary>Bank details shown on invoices</summary>
            <form action={bankAction} className="stack"><Field label="Account details" hint="Shown to people who pay by transfer."><textarea name="text" rows={4} maxLength={600} defaultValue={bank} /></Field><button className="btn" type="submit">Save</button></form></details>
        </section>
      ) : null}

      {view === "payments" && pays ? (
        <section className="stack"><h2>Payments</h2>
          <div className="row">{["", "PENDING", "SUCCEEDED", "FAILED", "REVIEW"].map((s) => <Link key={s} className="btn" href={`/admin/payments?view=payments&status=${s}`}>{s ? humanize(s) : "All"}</Link>)}</div>
          {pays.rows.length === 0 ? <p className="muted">No payments.</p> : pays.rows.map((p) => (
            <div key={p.id} className="card stack">
              <div className="row between"><div><strong>{p.ref}</strong> <span className="small muted">{p.invoice.ref} · {formatKobo(p.amountKobo)} · {humanize(p.provider)} · {formatDate(p.createdAt)}{p.refundedKobo > 0n ? ` · ${formatKobo(p.refundedKobo)} refunded` : ""}</span>{p.failureReason ? <div className="small">{p.failureReason}</div> : null}</div><Pill status={payTone(p.status)} label={p.status === "REVIEW" ? "Being checked" : humanize(p.status)} /></div>
              {refundForm(p)}
            </div>
          ))}
          {pager(pays.total)}
        </section>
      ) : null}

      {view === "events" && events ? (
        <section className="stack"><h2>Provider messages</h2>
          <p className="small muted">Every signed message from the payment provider, once. A repeated message is recognised and changes nothing.</p>
          {events.rows.length === 0 ? <p className="muted">None yet.</p> : (
            <div className="table-wrap"><table><thead><tr><th>When</th><th>Kind</th><th>Reference</th><th>Outcome</th></tr></thead>
              <tbody>{events.rows.map((e) => <tr key={e.id}><td>{formatDateTime(e.receivedAt)}</td><td>{e.kind}</td><td>{e.reference}</td><td>{humanize(e.outcome)}{e.note ? ` · ${e.note}` : ""}</td></tr>)}</tbody></table></div>
          )}
          {pager(events.total)}
        </section>
      ) : null}
    </div>
  );
}
