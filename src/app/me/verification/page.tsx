import Link from "next/link";
import { requireUser, getSession } from "@/lib/auth";
import { agentKyc } from "@/lib/services/kyc";
import { myCompanies } from "@/lib/services/companies";
import { Flash, sp, type SP } from "@/components/ui";
import { KycPanel } from "@/components/KycPanel";
import { identityProviders } from "@/lib/identity-providers";
import { submitAgentKycAction } from "./actions";

export const metadata = { title: "Agent verification" };
export const dynamic = "force-dynamic";

export default async function AgentVerificationPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const session = await getSession();
  const companies = await myCompanies(user.id);
  const current = companies.find((c) => c.companyId === session?.companyId) ?? companies[0];
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Agent verification</h1>
        <p className="muted">Verify your identity so clients can trust you. Only you and our verification team can see what you send; your employer sees only your trust level, like everyone else.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {current ? (
        <KycPanel autoReady={identityProviders().length > 0} kind="AGENT" view={await agentKyc(user.id)} action={submitAgentKycAction} docBase="/kyc/doc" extra={<input type="hidden" name="companyId" value={current.companyId} />} />
      ) : (
        <div className="card stack"><p>Agent checks are for people who work for a registered company. Ask your company to invite you, <Link href="/join?as=agent">create an agent account</Link> if you work for yourself, or <Link href="/join?as=company">register your company</Link>.</p></div>
      )}
    </div>
  );
}
