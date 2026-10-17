import { requireUser } from "@/lib/auth";
import { asPerson, listCollaborations } from "@/lib/services/collab";
import { Flash, sp, type SP } from "@/components/ui";
import { CollabList } from "@/components/CollabViews";

export const metadata = { title: "My collaborations" };
export const dynamic = "force-dynamic";

export default async function MyCollaborationsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const data = await listCollaborations(asPerson(user.id));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>My collaborations</h1><p className="muted">Invite an agent to work with you. You decide what to share, and you can take it back.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <CollabList data={data} base="/me/collaborations" newHref="/directory?kind=agents" />
    </div>
  );
}
