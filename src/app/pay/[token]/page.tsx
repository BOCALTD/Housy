import type { Metadata } from "next";
import { checkOnlinePayment, paymentForPayer } from "@/lib/services/client-payments";
import { rateLimit } from "@/lib/ratelimit";
import { visitorIp } from "@/lib/request-ip";
import { formatDateTime } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { KIND_WORDS } from "@/lib/client-payment-rules";
import { CopyButton } from "@/components/CopyButton";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { payOnlineAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Make a payment", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** What a client sees from a payment link: who is asking, for what, and how to pay (online through Paystack, or by transfer). */
export default async function PayPage({ params, searchParams: s }: { params: Promise<{ token: string }>; searchParams?: Promise<SP> }) {
  const { token } = await params;
  const searchParams = await s;
  const allowed = await rateLimit(`paylink:${await visitorIp()}`, 60, 60_000);
  // Back from Paystack: Housy asks Paystack what happened before showing the result.
  if (allowed && sp(searchParams, "checked")) await checkOnlinePayment(token).catch(() => null);
  const p = allowed ? await paymentForPayer(token).catch(() => null) : null;
  if (!p || p.status === "CANCELLED") {
    return (
      <section className="card art-empty" style={{ maxWidth: 560, margin: "40px auto" }}>
        <div className="art-empty-ico" aria-hidden="true">🔒</div>
        <h1>This payment link has closed</h1>
        <p className="muted">It may have been cancelled or replaced. Ask whoever sent it for a new one. Never pay anyone outside Housy for a link that does not open.</p>
      </section>
    );
  }
  return (
    <div className="stack-lg" style={{ maxWidth: 620, margin: "24px auto", width: "100%" }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small muted">{KIND_WORDS[p.kind]} requested by</span>
        <h1 style={{ overflowWrap: "anywhere" }}>{p.company}</h1>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <div className="row between" style={{ flexWrap: "wrap" }}>
          <strong style={{ fontSize: "1.6rem" }}>{formatKobo(p.amountKobo)}</strong>
          {p.status === "PAID" ? <span className="pill ok">Paid</span> : <span className="pill warn">Waiting for payment</span>}
        </div>
        <p style={{ overflowWrap: "anywhere" }}>{p.description}</p>
        <p className="small muted">Reference {p.ref}</p>
      </section>

      {p.status === "PAID" ? (
        <section className="card stack">
          <h2>Thank you</h2>
          <p>Payment received{p.paidAt ? ` on ${formatDateTime(p.paidAt)}` : ""}. {p.company} has been told{p.kind === "RENT" ? " and the receipt is on your lease record" : ""}.</p>
        </section>
      ) : p.suspended ? (
        <section className="card stack"><p>This company cannot take payments through Housy just now. Do not pay until it is resolved; contact Housy support if you were asked to pay elsewhere.</p></section>
      ) : (
        <>
          {p.online ? (
            <section className="card stack" aria-labelledby="online-h">
              <h2 id="online-h">Pay online</h2>
              <p className="small muted">By card, bank transfer or USSD on Paystack&apos;s secure page. The receipt goes to your email.</p>
              <form action={payOnlineAction} className="stack">
                <input type="hidden" name="token" value={token} />
                <div className="fields">
                  <Field label="Your name"><input name="name" required autoComplete="name" defaultValue={p.payerName} /></Field>
                  <Field label="Your email"><input name="email" type="email" required autoComplete="email" defaultValue={p.payerEmail} /></Field>
                </div>
                <div className="row"><button className="btn primary" type="submit" data-confirm={`Pay ${formatKobo(p.amountKobo)} to ${p.company}?`} data-confirm-body="You go to Paystack's secure page to pay, then come back here." data-confirm-ok="Continue to pay" data-confirm-tone="default">Pay {formatKobo(p.amountKobo)}</button></div>
              </form>
            </section>
          ) : null}
          {p.transfer ? (
            <section className="card stack" aria-labelledby="transfer-h">
              <h2 id="transfer-h">{p.online ? "Or pay by bank transfer" : "Pay by bank transfer"}</h2>
              <dl className="stack" style={{ gap: 4, margin: 0 }}>
                <div><dt className="small muted">Bank</dt><dd style={{ margin: 0 }}>{p.transfer.bankName}</dd></div>
                <div><dt className="small muted">Account name</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{p.transfer.accountName}</dd></div>
                <div><dt className="small muted">Account number</dt><dd style={{ margin: 0 }}><strong>{p.transfer.accountNumber}</strong></dd></div>
                <div><dt className="small muted">Narration</dt><dd style={{ margin: 0 }}>{p.ref}</dd></div>
              </dl>
              <div className="row" style={{ flexWrap: "wrap" }}><CopyButton text={p.transfer.accountNumber} label="Copy account number" done="Account number copied" /><CopyButton text={p.ref} label="Copy reference" done="Reference copied" /></div>
              <p className="small muted">Check the account name matches {p.company} before you send. {p.company} marks this as paid once the money arrives.</p>
            </section>
          ) : null}
          {!p.online && !p.transfer ? <section className="card"><p>{p.company} has not set up how to receive payments yet. Ask them before paying.</p></section> : null}
        </>
      )}
    </div>
  );
}
