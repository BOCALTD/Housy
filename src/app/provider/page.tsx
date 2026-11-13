import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { myProviderOrgs } from "@/lib/services/verification-network";
import { VP_ROLE_LABELS } from "@/lib/verification-network-rules";

export const metadata = { title: "Verification work" };
export const dynamic = "force-dynamic";

export default async function ProviderHome() {
  const user = await requireUser();
  const orgs = (await myProviderOrgs(user.id)).filter((o) => o.providerCode);
  if (orgs.length === 1) redirect(`/provider/${orgs[0].providerCode}`);
  return (
    <div className="wrap stack-lg vp">
      <h1>Verification work</h1>
      {orgs.length === 0 ? (
        <div className="card stack"><p>You are not part of a verification organisation yet.</p><p className="muted">If your organisation has been approved, open the invitation sent to you. To join the network, <Link href="/verification-partners">apply as a verification partner</Link>.</p></div>
      ) : (
        <ul className="vp-orgs">{orgs.map((o) => (
          <li key={o.id} className="card"><Link href={`/provider/${o.providerCode}`}><strong>{o.name}</strong><span className="small muted">{o.providerCode} · {VP_ROLE_LABELS[o.role]}{o.suspendedAt ? " · suspended" : ""}</span></Link></li>
        ))}</ul>
      )}
    </div>
  );
}
