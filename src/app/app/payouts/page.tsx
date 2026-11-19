import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime, toDateOnlyString, todayInLagos } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { siteOrigin } from "@/lib/origin";
import { payoutBanks, payoutSettings, payouts } from "@/lib/services/payouts";
import { CopyButton } from "@/components/CopyButton";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { cancelPayoutAction, decidePayoutAction, goPayAction, recordBankPayoutAction, refreshStripeAction, requestPayoutAction, savePayeeAction, savePayoutKeyAction, stripePayeeAction } from "./actions";

export const metadata = { title: "Paying contractors" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  REQUESTED: ["Waiting for approval", "warn"], APPROVED: ["Approved: to pay", "warn"], SENDING: ["Sending", "warn"], PAID: ["Paid", "ok"],
  FAILED: ["Did not go through", "bad"], REJECTED: ["Rejected", ""], CANCELLED: ["Cancelled", ""], REVERSED: ["Came back", "bad"],
};
const METHOD: Record<string, string> = { PAYSTACK: "Paystack transfer", STRIPE: "Stripe", BANK: "Bank transfer" };

export default async function PayoutsPage({ searchParams: spP }: { searchParams?: Promise<SP> }) {
  const searchParams = await spP;
  const m = await requireMember("payout.request");
  const approve = can(m.role, "payout.approve"), manage = can(m.role, "settings.manage");
  const [s, data, origin] = await Promise.all([payoutSettings(m), payouts(m), siteOrigin()]);
  const banks = s.paystack && approve ? await payoutBanks(m) : [];
  const link = sp(searchParams, "link");
  const waiting = data.rows.filter((r) => r.status === "REQUESTED");
  const toFinish = data.rows.filter((r) => r.status === "APPROVED" || r.status === "SENDING");
  const done = data.rows.filter((r) => !["REQUESTED", "APPROVED", "SENDING"].includes(r.status));
  const active = data.contractors.filter((c) => c.active);
  const payable = (c: (typeof data.contractors)[number]) => [c.paystackRecipient && s.paystack ? "Paystack" : "", c.stripeReady && s.stripe ? "Stripe" : "", c.accountNumber ? "bank transfer" : ""].filter(Boolean);
  const money = (k: bigint) => formatKobo(k, s.currency);

  const card = (r: (typeof data.rows)[number], actions: React.ReactNode = null) => (
    <li key={r.id} className="card stack" style={{ listStyle: "none", gap: 8 }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <strong>{money(r.amountKobo)} to {r.contractor.name}</strong>
        <span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
      </div>
      <p className="small" style={{ overflowWrap: "anywhere" }}>{r.reason}</p>
      <p className="small muted">{r.ref} · {METHOD[r.method]} · asked by {r.requestedByName} on {formatDate(r.requestedAt)}{r.decidedByName ? ` · ${r.status === "REJECTED" ? "rejected" : "approved"} by ${r.decidedByName}` : ""}{r.paidOn ? ` · paid ${formatDate(r.paidOn)}` : ""}{r.bankReference ? ` · bank reference ${r.bankReference}` : ""}</p>
      {r.decisionNote ? <p className="small muted">Note: {r.decisionNote}</p> : null}
      {r.failedReason ? <p className="small" style={{ color: "var(--danger, #b42318)" }}>{r.failedReason}</p> : null}
      {r.events.length > 1 ? (
        <details className="vp-fold"><summary>History ({r.events.length})</summary>
          <ul className="small" style={{ paddingLeft: 18 }}>{r.events.map((e) => <li key={e.id}>{formatDateTime(e.createdAt)}: {e.kind.replace(/_/g, " ")}{e.note ? `: ${e.note}` : ""}</li>)}</ul>
        </details>
      ) : null}
      {actions}
    </li>
  );

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Paying contractors</h1>
        <p className="muted">Pay contractors and suppliers. One person asks, a different person approves, and every payment goes into the accounting export. <Link href="/app/maintenance/contractors">Contractors</Link> · <Link href="/app/reports">Reports</Link></p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice"), warning: sp(searchParams, "warning") }} />
      {link ? (
        <div className="card stack" role="status">
          <strong>Stripe set-up link for the contractor</strong>
          <p className="small" style={{ overflowWrap: "anywhere" }}>{link}</p>
          <div className="row"><CopyButton text={link} label="Copy the link" /></div>
        </div>
      ) : null}

      {waiting.length ? (
        <section className="card stack" aria-labelledby="wait-h">
          <h2 id="wait-h">Waiting for approval ({waiting.length})</h2>
          <ShowMore noun="more payments" limit={3} items={waiting.map((r) => card(r, (
            <div className="stack" style={{ gap: 8 }}>
              {approve && r.requestedById !== m.userId ? (
                <form action={decidePayoutAction} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <Field label="Note (needed to reject)"><input name="note" maxLength={300} /></Field>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button className="btn primary" type="submit" name="decision" value="approve" data-confirm={`Approve ${money(r.amountKobo)} to ${r.contractor.name}?`} data-confirm-body={r.method === "PAYSTACK" ? "Paystack sends the money from your company's balance straight away. This cannot be undone here." : r.method === "STRIPE" ? "You then pay on Stripe's page, and Stripe passes the money to the contractor." : "You then pay from your company's bank and record the bank's reference here."} data-confirm-ok="Approve">Approve{r.method === "PAYSTACK" ? " and send" : ""}</button>
                    <button className="btn" type="submit" name="decision" value="reject">Reject</button>
                  </div>
                </form>
              ) : <p className="small muted">{r.requestedById === m.userId ? "Another person must approve a payment you asked for." : "A manager approves this payment."}</p>}
              {r.requestedById === m.userId || approve ? <form action={cancelPayoutAction}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit" data-confirm="Cancel this payment request?" data-confirm-ok="Cancel it">Cancel the request</button></form> : null}
            </div>
          )))} />
        </section>
      ) : null}

      {toFinish.length ? (
        <section className="card stack" aria-labelledby="finish-h">
          <h2 id="finish-h">Approved, being paid ({toFinish.length})</h2>
          <ShowMore noun="more payments" limit={3} items={toFinish.map((r) => card(r, approve ? (
            r.status === "SENDING" ? <p className="small muted">Paystack is sending this. It is checked every few minutes; the page shows the result.</p>
              : r.method === "STRIPE" ? (
                <div className="row wrap" style={{ gap: 8 }}>
                  {r.checkoutUrl ? <form action={goPayAction}><input type="hidden" name="url" value={r.checkoutUrl} /><button className="btn primary" type="submit">Pay {money(r.amountKobo)} on Stripe</button></form> : <p className="small muted">Opening Stripe&apos;s payment page failed. Cancel and ask again.</p>}
                  <form action={cancelPayoutAction}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit" data-confirm="Cancel this payment?" data-confirm-ok="Cancel it">Cancel</button></form>
                </div>
              ) : (
                <form action={recordBankPayoutAction} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <p className="small">Pay {r.contractor.name} from your company&apos;s bank, then record it.</p>
                  <div className="grid-2">
                    <Field label="Bank's reference"><input name="bankReference" required minLength={4} maxLength={100} /></Field>
                    <Field label="Paid on"><input name="paidOn" type="date" required max={toDateOnlyString(todayInLagos())} defaultValue={toDateOnlyString(todayInLagos())} /></Field>
                  </div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button className="btn primary" type="submit" data-confirm="Record this payment as paid?" data-confirm-body="It goes into the accounting export as money paid out of the bank." data-confirm-ok="Record">Record as paid</button>
                  </div>
                </form>
              )
          ) : null))} />
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="ask-h">
        <h2 id="ask-h">Ask for a payment</h2>
        {active.length === 0 ? <p className="muted">Add contractors and suppliers first in <Link href="/app/maintenance/contractors">Contractors</Link>.</p> : (
          <details className="vp-fold" open={!waiting.length && !toFinish.length}>
            <summary>New payment</summary>
            <form action={requestPayoutAction} className="stack">
              <div className="grid-2">
                <Field label="Pay"><select name="contractorId" required defaultValue=""><option value="" disabled>Choose…</option>{active.map((c) => <option key={c.id} value={c.id}>{c.name}{payable(c).length ? ` (${payable(c).join(", ")})` : " (add payment details first)"}</option>)}</select></Field>
                <Field label={`Amount (${s.currency})`}><input name="amount" inputMode="decimal" required placeholder="150,000" /></Field>
                <Field label="How"><select name="method" required defaultValue={s.paystack ? "PAYSTACK" : "BANK"}>
                  {s.paystack ? <option value="PAYSTACK">Paystack transfer (sent on approval)</option> : null}
                  {s.stripe ? <option value="STRIPE">Stripe (to the contractor&apos;s Stripe account)</option> : null}
                  <option value="BANK">Bank transfer (recorded after paying)</option>
                </select></Field>
                <Field label="Work order (optional)" hint="Payments on a work order cannot add up to more than its actual (or approved) cost."><select name="workOrderId" defaultValue=""><option value="">None</option>{data.workOrders.map((w) => <option key={w.id} value={w.id}>{w.ref} {w.title.slice(0, 50)}{w.actualCostKobo != null ? ` · ${money(w.actualCostKobo)}` : w.approvedCostKobo != null ? ` · approved ${money(w.approvedCostKobo)}` : ""}</option>)}</select></Field>
              </div>
              <Field label="What it is for"><input name="reason" required minLength={3} maxLength={300} placeholder="Invoice 0042: replacing the borehole pump" /></Field>
              <div className="row"><button className="btn primary" type="submit" data-confirm="Send this payment for approval?" data-confirm-body="A different person approves it before any money moves." data-confirm-ok="Send">Send for approval</button></div>
            </form>
          </details>
        )}
      </section>

      {approve ? (
        <section className="card stack" aria-labelledby="payees-h">
          <h2 id="payees-h">Where contractors are paid</h2>
          <p className="small muted">{s.paystack ? "Bank accounts are checked with the bank through your Paystack; the name the bank holds is saved." : "Without Paystack connected, bank details are kept as you type them, for bank transfers."}</p>
          {active.length === 0 ? <p className="muted">No contractors yet.</p> : (
            <ShowMore noun="more contractors" limit={4} items={active.map((c) => (
              <li key={c.id} style={{ listStyle: "none" }}>
                <details className="vp-fold">
                  <summary><strong>{c.name}</strong> <span className="small muted">{c.accountNumber ? `${c.accountName}, ${c.bankName} ending ${c.accountNumber.slice(-4)}${c.paystackRecipient ? " (checked)" : ""}` : "No bank account yet"}{c.stripeAccountId ? ` · Stripe ${c.stripeReady ? "ready" : "set-up not finished"}` : ""}</span></summary>
                  <form action={savePayeeAction} className="stack" style={{ marginTop: 8 }}>
                    <input type="hidden" name="contractorId" value={c.id} />
                    <div className="grid-2">
                      {s.paystack ? (
                        <Field label="Bank">{banks.length ? <select name="bankCode" required defaultValue={""}><option value="" disabled>Choose the bank…</option>{banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select> : <p className="small muted">Paystack did not list banks just now. Try again shortly.</p>}</Field>
                      ) : <Field label="Bank"><input name="bankName" required maxLength={120} defaultValue={c.bankName} /></Field>}
                      <Field label="Account number"><input name="accountNumber" required inputMode="numeric" maxLength={34} defaultValue={c.accountNumber} /></Field>
                      {!s.paystack ? <Field label="Account name" hint="Exactly as the bank has it."><input name="accountName" required maxLength={200} defaultValue={c.accountName} /></Field> : null}
                    </div>
                    <div className="row"><button className="btn" type="submit" data-confirm={`Save ${c.name}'s bank account?`} data-confirm-body="New payments to them go to this account." data-confirm-ok="Save">Save the bank account</button></div>
                  </form>
                  {s.stripe ? (
                    <div className="stack" style={{ marginTop: 8, gap: 8 }}>
                      <form action={stripePayeeAction} className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
                        <input type="hidden" name="contractorId" value={c.id} />
                        {!c.stripeAccountId ? <Field label="Contractor's email for Stripe"><input name="email" type="email" defaultValue={c.email} /></Field> : null}
                        <button className="btn small" type="submit">{c.stripeAccountId ? "New Stripe set-up link" : "Set up Stripe payouts"}</button>
                      </form>
                      {c.stripeAccountId && !c.stripeReady ? <form action={refreshStripeAction}><input type="hidden" name="contractorId" value={c.id} /><button className="btn small" type="submit">Check Stripe again</button></form> : null}
                    </div>
                  ) : null}
                </details>
              </li>
            ))} />
          )}
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="done-h">
        <h2 id="done-h">Finished ({done.length})</h2>
        {done.length === 0 ? <p className="muted">No finished payments yet.</p> : <ShowMore noun="more payments" limit={5} items={done.map((r) => card(r))} />}
      </section>

      {manage ? (
        <section className="card stack" aria-labelledby="ps-h">
          <h2 id="ps-h">Your company&apos;s Paystack</h2>
          {!s.paystackCountry ? <p className="small muted">Paystack transfers are for companies in Nigeria, Ghana, Kenya and South Africa. Pay by bank transfer{s.stripe ? " or Stripe" : ""} instead.</p> : (
            <>
              <p className="small muted">Transfers go from your own Paystack balance, so Housy uses your company&apos;s Paystack secret key (stored encrypted, never shown again). In Paystack, turn off the one-time code for transfers (Settings, Preferences) so approved payments can be sent.</p>
              {s.paystack ? <p><span className="pill ok">Connected{s.test ? " (test mode)" : ""}</span> <span className="small muted">Key {s.keyTail}</span></p> : <p><span className="pill warn">Not connected</span></p>}
              {s.webhookPath ? (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="small">In Paystack, Settings, API Keys and Webhooks, set the webhook address to:</span>
                  <code className="small" style={{ overflowWrap: "anywhere" }}>{origin}{s.webhookPath}</code>
                  <div className="row"><CopyButton text={`${origin}${s.webhookPath}`} label="Copy the address" done="Address copied" /></div>
                </div>
              ) : null}
              <details className="vp-fold" open={!s.paystack}><summary>{s.paystack ? "Change or disconnect" : "Connect Paystack"}</summary>
                <form action={savePayoutKeyAction} className="stack" autoComplete="off" style={{ marginTop: 8 }}>
                  <Field label="Secret key" hint="From Paystack, Settings, API Keys and Webhooks. Starts with sk_live_ (or sk_test_ to try it)."><input name="key" type="password" spellCheck={false} autoComplete="new-password" /></Field>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button className="btn primary" type="submit" name="intent" value="save" data-confirm="Connect this Paystack account?" data-confirm-body="Housy checks the key with Paystack first. Approved payments are then sent from this account's balance." data-confirm-ok="Connect">Save and check</button>
                    {s.paystack ? <button className="btn" type="submit" name="intent" value="disconnect" data-confirm="Disconnect Paystack?" data-confirm-body="Payments still waiting to be sent through Paystack will fail." data-confirm-ok="Disconnect">Disconnect</button> : null}
                  </div>
                </form>
              </details>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
