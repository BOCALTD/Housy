import { requireUser } from "@/lib/auth";
import { UpgradesHub } from "@/components/Upgrades";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Upgrades" };
export const dynamic = "force-dynamic";

export default async function MyUpgradesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const u = await requireUser();
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Upgrades</h1><p className="muted">Plans, free trials, promo codes and add-ons that help you find a home or grow your work as an agent.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <UpgradesHub payer={{ userId: u.id, companyId: null, role: null }} from="me" mayBuy cycle={sp(searchParams, "cycle") === "yearly" ? "yearly" : "plan"} code={sp(searchParams, "code") ?? ""} />
    </div>
  );
}
