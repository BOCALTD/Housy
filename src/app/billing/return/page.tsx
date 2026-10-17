import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { returnInfo, verifyPayment } from "@/lib/services/billing";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

/** Where the payment provider sends a person back to. The page does not trust the address it was opened with: it asks the provider. */
export default async function PaymentReturnPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const ref = sp(searchParams, "ref") ?? "";
  const info = ref ? await returnInfo(user.id, ref) : null;
  if (!info) return (<div className="card stack"><h1>Payment</h1><p>We could not find that payment.</p><Link href="/me/billing">Back to billing</Link></div>);
  const status = await verifyPayment(info.ref);
  const back = info.invoice.ownerCompanyId ? "/app/billing" : "/me/billing";
  return (
    <div className="card stack">
      <h1>{status === "SUCCEEDED" ? "Payment received" : status === "FAILED" ? "Payment did not go through" : status === "REVIEW" ? "Payment is being checked" : "Waiting for confirmation"}</h1>
      <p>{status === "SUCCEEDED" ? `Thank you. ${info.invoice.description} is now active.` : status === "FAILED" ? "No money was taken for it. You can try again from your billing page." : status === "REVIEW" ? "The amount received did not match the invoice. The platform administrator will look at it and get back to you." : "The payment provider has not confirmed this payment yet. This page does not change anything by itself: your plan starts only when the provider confirms. Check back in a few minutes."}</p>
      <div className="row"><Link className="btn primary" href={`${back}/${info.invoiceId}`}>View invoice</Link><Link className="btn" href={back}>Back to billing</Link></div>
    </div>
  );
}
