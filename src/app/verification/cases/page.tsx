import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Flash, sp, type SP } from "@/components/ui";
import { myCases } from "@/lib/services/verification-cases";
import { CaseStatusPill, day, serviceName } from "../case-ui";

export const metadata = { title: "My verification requests", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function MyCases({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const user = await requireUser();
  const rows = await myCases(user.id);
  return (
    <div className="wrap stack-lg vp" style={{ maxWidth: 860 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1>My verification requests</h1>
        <Link className="btn primary" href="/verification/request">New request</Link>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {rows.length === 0 ? (
        <div className="card stack"><p>You have not asked for a verification yet.</p><p className="small muted">From any listing, choose &quot;Ask for an independent verification&quot;, or start one here for any property.</p></div>
      ) : (
        <ul className="card vp-list">
          {rows.map((r) => (
            <li key={r.ref}>
              <Link href={`/verification/cases/${r.ref}`}><strong>{r.propertyAddress}</strong><span className="small muted">{r.ref} · {r.state} · {r.services.map(serviceName).join(", ")} · {day(r.createdAt)}</span></Link>
              <CaseStatusPill status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
