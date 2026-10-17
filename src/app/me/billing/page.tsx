import { requireUser } from "@/lib/auth";
import { BillingPanel } from "@/components/Billing";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function MyBillingPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Plan and billing</h1><p className="muted">Choose a plan, pay for it and see what you have been billed. Payments are checked with the payment provider before anything is switched on.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <BillingPanel payer={{ userId: user.id, companyId: null, role: null }} from="me" />
    </div>
  );
}
