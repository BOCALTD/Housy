import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myCompanies } from "@/lib/services/companies";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Flash, sp, type SP } from "@/components/ui";
import { switchCompanyAction } from "../../auth-actions";

export const metadata = { title: "Choose a company" };

export default async function SwitchPage({ searchParams }: { searchParams?: SP }) {
  const user = await requireUser();
  const companies = await myCompanies(user.id);
  return (
    <div style={{ maxWidth: 560, marginInline: "auto" }} className="stack">
      <h1>Choose a company</h1>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      {companies.length === 0 ? (
        <div className="card stack">
          <p>You are not an active member of any company.</p>
          <p className="muted small">Ask your administrator for an invitation, or register a new company.</p>
          <div className="row">
            <Link className="btn primary" href="/signup">Register a company</Link>
            {user.isPlatformAdmin ? <Link className="btn" href="/admin">Platform admin</Link> : null}
          </div>
        </div>
      ) : (
        <div className="stack">
          {companies.map((c) => (
            <form key={c.companyId} action={switchCompanyAction} className="card row between">
              <input type="hidden" name="companyId" value={c.companyId} />
              <div>
                <strong>{c.company.name}</strong>
                <p className="small muted">{ROLE_LABELS[c.role as Role]}</p>
              </div>
              <button className="btn" type="submit">Open</button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
