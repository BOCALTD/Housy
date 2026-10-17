import { requireMember } from "@/lib/auth";
import { AdsPanel } from "@/components/Ads";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Advertising" };
export const dynamic = "force-dynamic";

export default async function CompanyAdsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const m = await requireMember("billing.view");
  return (
    <div className="stack-lg">
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <AdsPanel payer={{ userId: m.userId, companyId: m.companyId, role: m.role }} from="app" />
    </div>
  );
}
