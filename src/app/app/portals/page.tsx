import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listGrants } from "@/lib/services/portals";
import { GRANT_STATUS_LABELS, PORTAL_LABELS, type GrantStatus, type PortalKind } from "@/lib/portal-rules";
import { formatDate } from "@/lib/dates";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { CheckList } from "@/components/CheckList";
import { InviteForm, ReissueForm } from "./InviteForm";
import { assetsAction, revokeAction } from "./actions";

export const metadata = { title: "Owner and vendor portals" };
export const dynamic = "force-dynamic";

const pill = (s: string) => (s === "ACTIVE" ? "ACTIVE" : s === "INVITED" ? "OPEN" : "SUSPENDED");

export default async function PortalsPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const member = await requireMember("portal.manage");
  const { grants, assets, contractors } = await listGrants(member);
  const live = grants.filter((g) => g.status !== "REVOKED");
  const removed = grants.filter((g) => g.status === "REVOKED");
  const activeContractors = contractors.filter((c) => c.active);

  const card = (g: (typeof grants)[number]) => (
    <li key={g.id} className="card stack portal-grant">
      <div className="row between wrap">
        <div><strong>{g.displayName}</strong> <span className="pill disc">{PORTAL_LABELS[g.kind as PortalKind]}</span><div className="small muted">{g.email}{g.acceptedAt ? ` · joined ${formatDate(g.acceptedAt)}` : ` · invited ${formatDate(g.createdAt)}`}{g.status === "INVITED" && g.inviteExpiresAt ? (g.inviteExpiresAt < new Date() ? " · link expired" : ` · link works until ${formatDate(g.inviteExpiresAt)}`) : ""}</div></div>
        <Pill status={pill(g.status)} label={GRANT_STATUS_LABELS[g.status as GrantStatus]} />
      </div>
      {g.kind === "OWNER" ? (
        <details className="inline"><summary>Sees {g.assets.length} {g.assets.length === 1 ? "property" : "properties"}</summary>
          {g.status !== "REVOKED" ? (
            <form action={assetsAction} className="stack">
              <input type="hidden" name="id" value={g.id} />
              <CheckList name="assetId" noun="more properties" checked={g.assets.map((x) => x.id)} items={assets.map((a) => ({ id: a.id, label: a.name, hint: a.ref }))} />
              <div className="row"><button className="btn" type="submit">Save properties</button></div>
            </form>
          ) : <ShowMore limit={6} noun="more properties" items={g.assets.map((a) => <li key={a.id}>{a.label}</li>)} />}
        </details>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          <p className="small">Jobs assigned to <strong>{g.contractorName || "a contractor"}</strong></p>
          {g.profile ? (
            <details className="inline"><summary>Vendor profile, updated {formatDate(g.profile.updatedAt)}</summary>
              <dl className="small stack" style={{ gap: 4 }}>
                {g.profile.serviceAreas ? <div><dt className="muted">Service areas</dt><dd>{g.profile.serviceAreas}</dd></div> : null}
                {g.profile.qualifications ? <div><dt className="muted">Qualifications</dt><dd style={{ whiteSpace: "pre-wrap" }}>{g.profile.qualifications}</dd></div> : null}
                {g.profile.insuranceNote ? <div><dt className="muted">Insurance</dt><dd>{g.profile.insuranceNote}</dd></div> : null}
                {g.profile.docName ? <div><dt className="muted">Compliance document</dt><dd><a className="tap" href={`/app/portals/doc/${g.id}`}>{g.profile.docName}</a></dd></div> : null}
              </dl>
              <p className="small muted">Provided by the vendor and not checked by Housy.</p>
            </details>
          ) : g.status === "ACTIVE" ? <p className="small muted">They have not filled in their profile yet.</p> : null}
        </div>
      )}
      {g.status !== "REVOKED" ? (
        <div className="row wrap">
          {g.status === "INVITED" ? <ReissueForm id={g.id} who={g.displayName} /> : null}
          <form action={revokeAction}><input type="hidden" name="id" value={g.id} /><button className="btn danger" type="submit">Remove access</button></form>
        </div>
      ) : <p className="small muted">Removed {g.revokedAt ? formatDate(g.revokedAt) : ""}</p>}
    </li>
  );

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Owner and vendor portals</h1>
        <p className="muted">Give a property owner a read-only view of the properties you manage for them, or give a contractor a place to see the jobs you assign and send quotations, invoices and completion reports. They see nothing else of your company, and you can remove access at any time.</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <div className="two">
        <section className="card stack"><h2>Invite an owner</h2>
          <p className="small muted">They will see listing performance (visits and enquiry counts, never who enquired), inspections, tenancies and rent position, maintenance and approved valuation reports for the properties you tick.</p>
          <InviteForm kind="OWNER" assets={assets} contractors={[]} />
        </section>
        <section className="card stack"><h2>Invite a vendor</h2>
          <p className="small muted">They will see only the work orders assigned to that contractor, from the moment of assignment, without tenant contact details or internal notes.</p>
          {activeContractors.length ? <InviteForm kind="VENDOR" assets={[]} contractors={activeContractors} /> : <p className="muted">Add a contractor in <Link href="/app/maintenance/contractors">Maintenance</Link> first.</p>}
        </section>
      </div>
      <section className="stack"><h2>People with access ({live.length})</h2>
        {live.length ? <ShowMore limit={8} noun="more people" items={live.map(card)} /> : <p className="muted">No one yet.</p>}
      </section>
      {removed.length ? <details className="card inline"><summary>Access removed ({removed.length})</summary><ShowMore limit={6} noun="more" items={removed.map(card)} /></details> : null}
    </div>
  );
}
