import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { AdDetail } from "@/components/Ads";
import { campaignReport } from "@/lib/services/ads";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

export default async function CompanyAdPage({ params, searchParams }: { params: { ref: string }; searchParams?: SP }) {
  const m = await requireMember("billing.view");
  const payer = { userId: m.userId, companyId: m.companyId, role: m.role };
  const r = await campaignReport({ payer }, params.ref);
  if (!r) notFound();
  return (<div className="stack-lg"><Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} /><AdDetail payer={payer} from="app" r={r} /></div>);
}
