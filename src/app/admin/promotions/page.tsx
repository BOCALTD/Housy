import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { listCampaigns, promoQueue, readPaymentInstructions, THEMES } from "@/lib/services/promotions";
import { formatKobo } from "@/lib/money";
import { formatDate, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { PromoRibbon } from "@/components/Promo";
import { campaignActiveAction, instructionsAction, paymentAction, reviewPromoAction, saveCampaignAction } from "./actions";

export const metadata = { title: "Promotions" };
export const dynamic = "force-dynamic";

export default async function AdminPromotionsPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const [campaigns, queue, instructions] = await Promise.all([listCampaigns(), promoQueue(admin.id, "REQUESTED"), readPaymentInstructions()]);
  const form = (c?: (typeof campaigns)[number]) => (
    <form action={saveCampaignAction} className="stack">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <div className="fields">
        <Field label="Name" hint="For example Black Friday."><input name="name" required defaultValue={c?.name ?? ""} /></Field>
        <Field label="Tagline"><input name="tagline" defaultValue={c?.tagline ?? ""} /></Field>
        <Field label="Look"><select name="theme" defaultValue={c?.theme ?? "RED"}>{THEMES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
        <Field label="Starts"><input name="startsOn" type="date" required defaultValue={c ? toDateOnlyString(c.startsOn) : ""} /></Field>
        <Field label="Ends"><input name="endsOn" type="date" required defaultValue={c ? toDateOnlyString(c.endsOn) : ""} /></Field>
        <Field label="Fee per property (₦)" hint="Charged to Basic companies. Silver and Gold pay nothing."><input name="fee" inputMode="decimal" defaultValue={c ? String(Number(c.feeKobo) / 100) : "0"} /></Field>
        <Field label="Biggest discount allowed (%)"><input name="maxDiscountPct" inputMode="numeric" defaultValue={c?.maxDiscountPct ?? 60} /></Field>
      </div>
      <button className="btn primary" type="submit">{c ? "Save campaign" : "Create campaign"}</button>
    </form>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><p className="eyebrow">Platform Super Super Admin</p><h1>Promotions</h1>
        <p className="muted">Run sales such as Black Friday, decide what they cost, and approve the properties companies put forward. <Link href="/admin">Back to platform administration</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Waiting for review ({queue.length})</h2>
        {queue.length === 0 ? <p className="muted">Nothing is waiting.</p> : (
          <ShowMore noun="more requests" limit={4} items={queue.map((e) => {
            const pending = e.payment?.status === "PENDING";
            const stale = !!e.listing && e.listing.priceKobo !== e.originalPriceKobo;
            return (
              <li key={e.id}><div className="stack" style={{ width: "100%" }}>
                <div className="row between"><div><strong>{e.listing?.title ?? "Property"}</strong> <span className="small muted">{e.companyName} · {e.campaign.name} · <span className="mono">{e.ref}</span></span></div>
                  <Pill status={pending ? "PENDING" : "ACTIVE"} label={e.payment?.status === "NOT_REQUIRED" ? "No payment due" : pending ? `Awaiting ${formatKobo(e.payment!.feeKobo)}` : "Payment confirmed"} /></div>
                <div className="small">Was {formatKobo(e.originalPriceKobo)}, offered at {formatKobo(e.promoPriceKobo)}.{stale ? " The listed price has changed since this request." : ""}</div>
                {pending ? (
                  <form action={paymentAction} className="row"><input type="hidden" name="entryId" value={e.id} />
                    <Field label="Payment reference"><input name="reference" required minLength={4} /></Field><Field label="Note"><input name="note" /></Field>
                    <button className="btn" type="submit">Payment received</button></form>
                ) : null}
                <form action={reviewPromoAction} className="row"><input type="hidden" name="entryId" value={e.id} />
                  <Field label="Note (needed to turn down)"><input name="note" /></Field>
                  <button className="btn primary" type="submit" name="decision" value="approve">Approve</button>
                  <button className="btn" type="submit" name="decision" value="reject">Turn down</button></form>
              </div></li>
            );
          })} />
        )}
      </section>

      <section className="card stack">
        <h2>Campaigns ({campaigns.length})</h2>
        {campaigns.length === 0 ? <p className="muted">No campaign yet.</p> : (
          <ShowMore noun="more campaigns" limit={4} items={campaigns.map((c) => (
            <li key={c.id}><div className="stack" style={{ width: "100%" }}>
              <div className="promo-tags"><PromoRibbon name={c.name} pct={c.maxDiscountPct} theme={c.theme} /><Pill status={c.active ? "ACTIVE" : "SUSPENDED"} label={c.active ? "Running" : "Ended"} /></div>
              <div className="small muted">{formatDate(c.startsOn)} to {formatDate(c.endsOn)} · fee {formatKobo(c.feeKobo)} per property for Basic</div>
              <details className="inline"><summary>Edit</summary>{form(c)}
                <form action={campaignActiveAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? "no" : "yes"} /><button className="btn" type="submit">{c.active ? "End campaign now" : "Run campaign again"}</button></form></details>
            </div></li>))} />
        )}
        <details className="inline"><summary>New campaign</summary>{form()}</details>
      </section>

      <section className="card stack">
        <h2>How companies pay</h2>
        <form action={instructionsAction} className="stack">
          <Field label="Payment instructions shown to Basic companies" hint="For example the account to pay and the reference to use. Payments are confirmed by hand."><textarea name="instructions" rows={3} defaultValue={instructions} maxLength={600} /></Field>
          <button className="btn primary" type="submit">Save</button>
        </form>
      </section>
    </div>
  );
}
