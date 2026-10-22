import { requireMember } from "@/lib/auth";
import { companyKyc } from "@/lib/services/kyc";
import { Flash, sp, type SP } from "@/components/ui";
import { KycPanel } from "@/components/KycPanel";
import { submitCompanyKycAction } from "./actions";

export const metadata = { title: "Company verification" };
export const dynamic = "force-dynamic";

export default async function CompanyVerificationPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("kyc.manage");
  const view = await companyKyc(member);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Company verification</h1>
        <p className="muted">Each check is reviewed by a person on our team. The public sees only your trust level and which checks passed, with their dates. Documents and ID numbers are never shown publicly; ID numbers are stored encrypted.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <KycPanel kind="COMPANY" view={view} action={submitCompanyKycAction} docBase="/kyc/doc" />
    </div>
  );
}
