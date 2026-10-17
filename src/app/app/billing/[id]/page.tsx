import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { invoiceFor } from "@/lib/services/billing";
import { InvoicePanel } from "@/components/Billing";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function CompanyInvoicePage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const m = await requireMember("billing.view");
  const payer = { userId: m.userId, companyId: m.companyId, role: m.role };
  const invoice = await invoiceFor(payer, params.id);
  if (!invoice) notFound();
  return (<div className="stack-lg"><Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} /><InvoicePanel payer={payer} from="app" invoice={invoice} /></div>);
}
