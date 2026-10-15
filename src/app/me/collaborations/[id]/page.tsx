import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asPerson, getWorkspace } from "@/lib/services/collab";
import { Flash, sp, type SP } from "@/components/ui";
import { CollabWorkspaceView } from "@/components/CollabViews";

export const metadata = { title: "Collaboration" };
export const dynamic = "force-dynamic";

export default async function MyCollaborationPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const user = await requireUser();
  let w;
  try { w = await getWorkspace(asPerson(user.id), params.id); } catch { notFound(); }
  return (
    <div className="stack-lg">
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <CollabWorkspaceView w={w} extras={{ colleagues: [], deals: [], assets: [] }} base="/me/collaborations" />
    </div>
  );
}
