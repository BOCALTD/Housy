import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { banks, clientPayments, paymentSettings } from "@/lib/services/client-payments";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { siteOrigin } from "@/lib/origin";
import { KIND_WORDS, type ClientPaymentKind } from "@/lib/client-payment-rules";
import { CopyButton } from "@/components/CopyButton";
import { Field, Flash, Pager, Pill, sp, type SP } from "@/components/ui";
import { cancelRequestAction, confirmTransferAction, newLinkAction, requestOtherAction, saveBankAction, saveFeeAction } from "./actions";

export const metadata = { title: "Client payments" };
export const dynamic = "force-dynamic";

const STATUS_WORDS: Record<string, string> = { PENDING: "Waiting", PAID: "Paid", CANCELLED: "Cancelled" };
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}%`;
const koboText = (k: bigint) => (k === 0n ? "0" : `${k / 100n}${k % 100n ? `.${String(k % 100n).padStart(2, "0")}` : ""}`);
const PAGE = 20;

export default async function ClientPaymentsPage({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const m = await requireMember("billing.view");
  const status = ["PENDING", "PAID", "CANCELLED"].includes(sp(searchParams, "status") ?? "") ? sp(searchParams, "status")! : "";
  const page = Math.max(0, Number(sp(searchParams, "page")) || 0);
  const [info, rows, bankList, origin] = await Promise.all([paymentSettings(m), clientPayments(m, { status }), banks(), siteOrigin()]);
  const manage = can(m.role, "billing.manage"), record = can(m.role, "payment.record");
  const link = sp(searchParams, "link");
  const fullLink = link && /^\/pay\/[A-Za-z0-9_-]{20,64}$/.test(link) ? `${origin}${link}` : null;
  const st = info.settings;
  const shown = rows.slice(page * PAGE, (page + 1) * PAGE);
  const href = (p: number) => `/app/payments?${new URLSearchParams({ ...(status ? { status } : {}), ...(p ? { page: String(p) } : {}) })}`;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Client payments</h1>
        <p className="muted">Take rent, inspection fees and other payments from clients through Housy: online by card or bank (it settles to your bank), or by direct transfer to your account.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {fullLink ? (
        <section className="card stack" aria-labelledby="link-h">
          <h2 id="link-h">Payment link</h2>
          <p className="small muted">Send this to the payer by message or email. It is shown only now; you can make a new one from the list later.</p>
          <code className="break">{fullLink}</code>
          <div className="row"><CopyButton text={fullLink} label="Copy link" /></div>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card stack" aria-labelledby="bank-h">
          <h2 id="bank-h">Where payments go</h2>
          {st?.accountNumber ? (
            <p className="small"><strong>{st.accountName}</strong><br />{st.bankName} · {st.accountNumber}<br />
              {info.online ? <span className="pill ok">Online payments on</span> : <span className="pill">Bank transfer only</span>}</p>
          ) : <p className="small muted">No account saved yet. Clients cannot pay you through Housy until you add one.</p>}
          {!info.paystackConnected ? <p className="small muted">Online payments are not switched on for Housy yet, so clients pay by bank transfer to this account.</p> : null}
          {manage ? (
            <details className="vp-fold" open={!st?.accountNumber}>
              <summary>{st?.accountNumber ? "Change the account" : "Add the account"}</summary>
              <form action={saveBankAction} className="stack">
                {info.paystackConnected && bankList.length ? (
                  <>
                    <Field label="Bank"><select name="bankCode" required defaultValue={st?.bankCode ?? ""}><option value="" disabled>Choose the bank</option>{bankList.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select></Field>
                    <Field label="Account number" hint="10 digits. The bank confirms the account name."><input name="accountNumber" required inputMode="numeric" pattern="[0-9 ]{10,13}" defaultValue={st?.accountNumber ?? ""} autoComplete="off" /></Field>
                  </>
                ) : (
                  <>
                    <Field label="Bank"><input name="bankName" required defaultValue={st?.bankName ?? ""} /></Field>
                    <Field label="Account number" hint="10 digits"><input name="accountNumber" required inputMode="numeric" pattern="[0-9 ]{10,13}" defaultValue={st?.accountNumber ?? ""} autoComplete="off" /></Field>
                    <Field label="Account name" hint="Exactly as the bank shows it"><input name="accountName" required defaultValue={st?.accountName ?? ""} /></Field>
                  </>
                )}
                <div className="row"><button className="btn primary" type="submit" data-confirm="Save this bank account?" data-confirm-body="Client payments made from now on go to this account." data-confirm-ok="Save" data-confirm-tone="default">Save account</button></div>
              </form>
            </details>
          ) : null}
        </section>

        <section className="card stack" aria-labelledby="fee-h">
          <h2 id="fee-h">Inspection fee</h2>
          <p className="small">{st && st.inspectionFeeKobo > 0n ? <>Each confirmed inspection asks for <strong>{formatKobo(st.inspectionFeeKobo)}</strong>, paid through Housy.</> : "Inspections are free."}</p>
          {manage ? (
            <form action={saveFeeAction} className="stack">
              <Field label="Fee (₦)" hint="0 keeps inspections free. The person is asked to pay when you confirm the time."><input name="fee" inputMode="decimal" defaultValue={koboText(st?.inspectionFeeKobo ?? 0n)} /></Field>
              <div className="row"><button className="btn" type="submit" data-confirm="Save the inspection fee?" data-confirm-body="It applies to inspections you confirm from now on." data-confirm-ok="Save" data-confirm-tone="default">Save fee</button></div>
            </form>
          ) : null}
          <h3 className="small" style={{ marginTop: 8 }}>Housy's commission</h3>
          <p className="small muted">Rent {pct(info.commissionBps.RENT)} · inspection fees {pct(info.commissionBps.INSPECTION)} · other payments {pct(info.commissionBps.OTHER)}. Online, it is taken when the client pays. On transfers you confirm and rent you record as received directly, it is invoiced monthly under Billing.</p>
        </section>
      </div>

      {record ? (
        <section className="card stack" aria-labelledby="req-h">
          <details className="vp-fold">
            <summary id="req-h">Ask for a payment</summary>
            <p className="small muted">For a deposit, service charge, agency or legal fee. For rent, use “Send a payment link” on the lease.</p>
            <form action={requestOtherAction} className="stack">
              <Field label="What it is for"><input name="description" required minLength={3} maxLength={300} /></Field>
              <div className="fields">
                <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" /></Field>
                <Field label="Payer's name"><input name="payerName" required /></Field>
              </div>
              <Field label="Payer's email" hint="Optional: they can enter it when paying"><input name="payerEmail" type="email" /></Field>
              <div className="row"><button className="btn primary" type="submit">Make payment link</button></div>
            </form>
          </details>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="list-h">
        <div className="row between" style={{ flexWrap: "wrap" }}>
          <h2 id="list-h">Payments</h2>
          <nav className="row" aria-label="Filter" style={{ flexWrap: "wrap" }}>
            {[["", "All"], ["PENDING", "Waiting"], ["PAID", "Paid"], ["CANCELLED", "Cancelled"]].map(([v, l]) => (
              <Link key={v} className={`btn small${status === v ? " primary" : ""}`} href={v ? `/app/payments?status=${v}` : "/app/payments"} aria-current={status === v ? "page" : undefined}>{l}</Link>
            ))}
          </nav>
        </div>
        {shown.length ? (
          <ul className="vp-list">
            {shown.map((p) => (
              <li key={p.id} style={{ flexWrap: "wrap" }}>
                <span className="stack" style={{ gap: 2, minWidth: 0, flex: "1 1 220px" }}>
                  <strong>{formatKobo(p.amountKobo)} · {KIND_WORDS[p.kind as ClientPaymentKind] ?? p.kind}</strong>
                  <span className="small muted" style={{ overflowWrap: "anywhere" }}>{p.description}{p.payerName ? ` · ${p.payerName}` : ""}</span>
                  <span className="small muted">{p.ref} · {p.paidAt ? `paid ${formatDateTime(p.paidAt)}${p.method === "ONLINE" ? " online" : " directly"}` : `asked ${formatDate(p.createdAt)}`}{p.commissionKobo > 0n ? ` · Housy ${formatKobo(p.commissionKobo)}` : ""}</span>
                </span>
                <Pill status={p.status === "PENDING" ? "PENDING" : p.status === "PAID" ? "PAID" : "CANCELLED"} label={STATUS_WORDS[p.status]} />
                {record && p.status === "PENDING" ? (
                  <details className="vp-fold" style={{ flexBasis: "100%" }}>
                    <summary>Manage</summary>
                    <div className="stack">
                      <form action={newLinkAction} className="row"><input type="hidden" name="ref" value={p.ref} /><button className="btn small" type="submit" data-confirm="Make a new link?" data-confirm-body="The link sent before stops working." data-confirm-ok="Make new link" data-confirm-tone="default">New link</button></form>
                      {p.kind !== "RENT" ? (
                        <form action={confirmTransferAction} className="stack"><input type="hidden" name="ref" value={p.ref} />
                          <Field label="Paid by transfer: reference" hint="The bank reference or other evidence"><input name="evidence" required minLength={3} /></Field>
                          <div className="row"><button className="btn small" type="submit" data-confirm="Mark this as paid?" data-confirm-body="Only once the money is in your account. Housy's commission is added to next month's invoice." data-confirm-ok="Mark paid" data-confirm-tone="default">Mark paid</button></div>
                        </form>
                      ) : <p className="small muted">Rent paid directly: record it on the lease and this link closes.</p>}
                      <form action={cancelRequestAction} className="stack"><input type="hidden" name="ref" value={p.ref} />
                        <Field label="Why cancel"><input name="reason" required minLength={3} /></Field>
                        <div className="row"><button className="btn small danger" type="submit" data-confirm="Cancel this payment request?" data-confirm-body="Its link stops working." data-confirm-ok="Cancel request">Cancel request</button></div>
                      </form>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="small muted">No payments{status ? " here" : " yet"}.</p>}
        <Pager page={page} total={rows.length} pageSize={PAGE} href={href} noun="payments" />
      </section>
    </div>
  );
}
