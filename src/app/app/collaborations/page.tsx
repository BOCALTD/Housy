import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { asCompany, listCollaborations } from "@/lib/services/collab";
import { can } from "@/lib/permissions";
import { Flash, sp, type SP } from "@/components/ui";
import { CollabList } from "@/components/CollabViews";

export const metadata = { title: "Collaborations" };
export const dynamic = "force-dynamic";

export default async function CollaborationsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("collab.view");
  const data = await listCollaborations(asCompany(member));
  const supervisor = can(member.role, "collab.company");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Collaborations</h1>
        <p className="muted">Work with another company, or with a seeker, in a shared workspace. Neither side sees the other&apos;s records. {supervisor ? <><Link href="/app/collaborations/report">Report</Link> · </> : null}<Link href="/directory?kind=companies">Find companies</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {supervisor ? <CollabList data={data} base="/app/collaborations" newHref="/app/collaborations/new" /> : <CollabList data={{ ...data, toAnswer: [] }} base="/app/collaborations" newHref="/directory?kind=companies" />}
    </div>
  );
}
