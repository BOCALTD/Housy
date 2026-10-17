import { requireUser } from "@/lib/auth";
import { AdsPanel } from "@/components/Ads";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Advertising" };
export const dynamic = "force-dynamic";

export default async function MyAdsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  return (
    <div className="stack-lg">
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <AdsPanel payer={{ userId: user.id, companyId: null, role: null }} from="me" />
    </div>
  );
}
