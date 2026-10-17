import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { asCompany, inviteableCompanies } from "@/lib/services/collab";
import { Flash, sp, type SP } from "@/components/ui";
import { CollabNewForm } from "@/components/CollabViews";

export const metadata = { title: "Invite a company" };
export const dynamic = "force-dynamic";

export default async function NewCollaborationPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("collab.company");
  const companies = await inviteableCompanies(asCompany(member));
  const chosen = companies.find((c) => c.companyId === sp(searchParams, "company"));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Invite a company</h1><p className="muted"><Link href="/app/collaborations">Back to collaborations</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {chosen ? <CollabNewForm kind="COMPANY_COMPANY" company={chosen.companyId} targetName={chosen.displayName} hasCompany /> : (
        <section className="card"><h2>Who do you want to work with?</h2>
          {companies.length === 0 ? <p className="muted">No other company is listed yet.</p> : (
            <ul className="timeline">{companies.slice(0, 8).map((c) => <li key={c.companyId}><Link href={`/app/collaborations/new?company=${c.companyId}`}>{c.displayName}</Link></li>)}</ul>
          )}
          {companies.length > 8 ? <p className="small muted">Search the <Link href="/directory?kind=companies">directory</Link> for more, then choose Invite to collaborate.</p> : null}
        </section>
      )}
    </div>
  );
}
