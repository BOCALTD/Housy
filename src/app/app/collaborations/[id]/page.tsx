import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { asCompany, getWorkspace, myAssetChoices, myColleagues, myDealChoices } from "@/lib/services/collab";
import { Flash, sp, type SP } from "@/components/ui";
import { CollabWorkspaceView } from "@/components/CollabViews";

export const metadata = { title: "Collaboration" };
export const dynamic = "force-dynamic";

export default async function CollaborationPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("collab.view");
  const a = asCompany(member);
  let w;
  try { w = await getWorkspace(a, params.id); } catch { notFound(); }
  const [colleagues, deals, assets] = await Promise.all([myColleagues(a), myDealChoices(a), myAssetChoices(a)]);
  return (
    <div className="stack-lg">
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <CollabWorkspaceView w={w} extras={{ colleagues, deals, assets }} base="/app/collaborations" />
    </div>
  );
}
