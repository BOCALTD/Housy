import { requireMember } from "@/lib/auth";
import { BillingPanel } from "@/components/Billing";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Plan and billing" };
export const dynamic = "force-dynamic";

export default async function CompanyBillingPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const m = await requireMember("billing.view");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Plan and billing</h1><p className="muted">The company's plan, its invoices and its payments. Only the company administrator can buy or stop a plan.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <BillingPanel payer={{ userId: m.userId, companyId: m.companyId, role: m.role }} from="app" />
    </div>
  );
}
