import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { UpgradesHub } from "@/components/Upgrades";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Upgrades" };
export const dynamic = "force-dynamic";

export default async function CompanyUpgradesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const m = await requireMember();
  const mayBuy = can(m.role, "billing.manage");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Upgrades</h1><p className="muted">Plans, free trials, promo codes and add-ons that grow the business: more features, more reach and more trust.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <UpgradesHub payer={{ userId: m.userId, companyId: m.companyId, role: m.role }} from="app" mayBuy={mayBuy} cycle={sp(searchParams, "cycle") === "yearly" ? "yearly" : "plan"} code={mayBuy ? sp(searchParams, "code") ?? "" : ""} />
    </div>
  );
}
