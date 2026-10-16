import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { campaignReport } from "@/lib/services/ads";
import { ReportView } from "@/components/Ads";
import { PHASE_TEXT } from "@/lib/ad-rules";
import { formatKobo } from "@/lib/money";

export const metadata = { title: "Campaign results" };
export const dynamic = "force-dynamic";

export default async function AdminAdPage({ params }: { params: { ref: string } }) {
  const admin = await requirePlatformAdmin();
  const r = await campaignReport({ admin: admin.id }, params.ref);
  if (!r) notFound();
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>{r.campaign.name}</h1><p className="muted">{r.campaign.ref} · {PHASE_TEXT[r.phase]} · budget {formatKobo(r.campaign.budgetKobo)} · spent {formatKobo(r.campaign.spentKobo)} · <Link href="/admin/ads">Back</Link></p></div>
      <ReportView r={r} />
    </div>
  );
}
