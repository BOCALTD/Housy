import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myPortals } from "@/lib/services/portals";
import { formatDate } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Your portals" };
export const dynamic = "force-dynamic";

export default async function PortalHome({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const { grants, providers } = await myPortals(user.id);
  const empty = grants.length === 0 && providers.length === 0;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Portals</p>
        <h1>Your portals</h1>
        <p className="muted">Companies on Housy can let property owners, contractors and professional service providers see the records that concern them. Each portal shows only what that company chose to share with you.</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      {empty ? (
        <section className="card stack"><h2>No portals yet</h2><p className="muted">When a company invites you, open the link they send while signed in as {user.email}.</p><p><Link className="tap" href="/me">Back to your account</Link></p></section>
      ) : (
        <div className="portal-tiles">
          {grants.map((g) => (
            <Link key={g.id} className="portal-tile" href={`/portal/${g.kind === "OWNER" ? "owner" : "vendor"}/${g.id}`}>
              <span className="pill disc" style={{ alignSelf: "flex-start" }}>{g.kind === "OWNER" ? "Owner portal" : "Vendor portal"}</span>
              <strong>{g.companyName}</strong>
              <span className="small muted">As {g.displayName}{g.acceptedAt ? ` · since ${formatDate(g.acceptedAt)}` : ""}</span>
            </Link>
          ))}
          {providers.map((p) => (
            <Link key={p.id} className="portal-tile" href={`/portal/provider/${p.id}`}>
              <span className="pill disc" style={{ alignSelf: "flex-start" }}>Provider portal</span>
              <strong>{p.name}</strong>
              <span className="small muted">Requests people chose to send to {p.shortName}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
