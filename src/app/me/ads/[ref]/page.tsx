import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AdDetail } from "@/components/Ads";
import { campaignReport } from "@/lib/services/ads";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

export default async function MyAdPage({ params, searchParams }: { params: { ref: string }; searchParams?: SP }) {
  const user = await requireUser();
  const payer = { userId: user.id, companyId: null, role: null };
  const r = await campaignReport({ payer }, params.ref);
  if (!r) notFound();
  return (<div className="stack-lg"><Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} /><AdDetail payer={payer} from="me" r={r} /></div>);
}
