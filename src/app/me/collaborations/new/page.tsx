import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { directory } from "@/lib/services/community";
import { Flash, sp, type SP } from "@/components/ui";
import { CollabNewForm } from "@/components/CollabViews";

export const metadata = { title: "Invite an agent" };
export const dynamic = "force-dynamic";

export default async function NewSeekerCollaborationPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const agent = sp(searchParams, "agent");
  if (!agent) redirect("/directory?kind=agents");
  const { rows } = await directory({ kind: "agents", q: "", page: 1, viewerId: user.id });
  const chosen = rows.find((r) => r.targetId === agent);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Invite an agent</h1><p className="muted"><Link href="/me/collaborations">Back to my collaborations</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <CollabNewForm kind="SEEKER_AGENT" agent={agent} targetName={chosen?.name ?? "this agent"} hasCompany={false} />
    </div>
  );
}
