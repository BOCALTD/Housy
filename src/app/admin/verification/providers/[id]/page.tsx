import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { providerForAdmin, serviceCategories } from "@/lib/services/verification-network";
import { STATES } from "@/lib/geo-rules";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { DOC_KINDS, ORG_TYPES, VP_ROLE_LABELS, type VpRole } from "@/lib/verification-network-rules";
import { restrictAction, suspendAction } from "../../actions";

export const metadata = { title: "Provider" };
export const dynamic = "force-dynamic";

export default async function ProviderAdmin({ params: p, searchParams: s }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const { id } = await p;
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const pr = await providerForAdmin(admin.id, id);
  if (!pr) notFound();
  const cats = await serviceCategories(false);
  return (
    <div className="stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow"><Link href="/admin/verification">Verification network</Link> · {pr.providerCode ?? "Not vetted"}</p>
        <h1>{pr.name}</h1>
        <p className="row wrap">
          <span className={`pill ${pr.suspendedAt ? "bad" : pr.status === "APPROVED" ? "ok" : "warn"}`}>{pr.suspendedAt ? "Suspended" : pr.status === "APPROVED" ? (pr.vettedAt ? "Working" : "Listed, not vetted") : "Pending"}</span>
          {pr.application ? <Link className="small" href={`/admin/verification/applications/${pr.application.ref}`}>Application {pr.application.ref}</Link> : <span className="small muted">No application on record: not vetted through the network yet.</span>}
        </p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {pr.suspendedAt ? <div className="flash error" role="status">Suspended since {pr.suspendedAt.toLocaleDateString("en-NG")}: {pr.suspendedReason}</div> : null}
      <div className="two">
        <div className="stack">
          <section className="card stack"><h2>Organisation</h2>
            <dl className="vp-dl">
              <dt>Registered name</dt><dd>{pr.legalName || "—"}</dd>
              <dt>Kind</dt><dd>{ORG_TYPES.find((x) => x[0] === pr.orgType)?.[1] ?? "—"}</dd>
              <dt>CAC</dt><dd>{pr.cacNumber || "—"} · {pr.country}</dd>
              <dt>Contact</dt><dd>{pr.contactEmail || "—"} · {pr.contactPhone || "—"}</dd>
              <dt>Offers</dt><dd>{pr.offerings.filter((o) => o.active).map((o) => cats.find((c) => c.code === o.categoryCode)?.name ?? o.categoryCode).join("; ") || "Nothing set up yet"}</dd>
              <dt>Works in</dt><dd>{pr.coverage.map((c) => c.state).join(", ") || "Not set up yet"}</dd>
            </dl>
          </section>
          <section className="card stack"><h2>Staff ({pr.members.length})</h2>
            <p className="small muted">Housy sees who works for the organisation; the organisation manages its own staff.</p>
            <ul className="vp-docs">{pr.members.map((m) => <li key={m.id}><span><strong>{m.name}</strong><span className="small muted">{m.email} · {VP_ROLE_LABELS[m.role as VpRole]}{m.status !== "ACTIVE" ? " · suspended" : ""}</span></span></li>)}</ul>
            {pr.invitations.length ? <p className="small muted">Open invitations: {pr.invitations.map((i) => `${i.email} (${VP_ROLE_LABELS[i.role as VpRole]})`).join("; ")}</p> : null}
          </section>
          <section className="card stack"><h2>Documents ({pr.documents.length})</h2>
            <ul className="vp-docs">{pr.documents.map((d) => <li key={d.id}><span><strong>{d.title}</strong><span className="small muted">{DOC_KINDS.find((k) => k[0] === d.kind)?.[1]}{d.expiresOn ? ` · valid until ${d.expiresOn.toISOString().slice(0, 10)}` : ""}</span></span><a className="btn small" href={`/verification-partners/doc/${d.id}`} target="_blank" rel="noopener">Open</a></li>)}</ul>
          </section>
        </div>
        <aside className="stack">
          <section className="card stack"><h2>What it is approved for</h2>
            <form action={restrictAction} className="stack"><input type="hidden" name="id" value={pr.id} />
              <fieldset className="vp-fs"><legend>Services</legend><div className="vp-checks">{cats.map((c) => <label key={c.code} className="check"><input type="checkbox" name="allowedServices" value={c.code} defaultChecked={pr.allowedServices.includes(c.code)} /> {c.name}</label>)}</div></fieldset>
              <details className="vp-fold"><summary>States ({pr.allowedStates.length})</summary><div className="vp-checks vp-states">{STATES.map((x) => <label key={x.name} className="check"><input type="checkbox" name="allowedStates" value={x.name} defaultChecked={pr.allowedStates.includes(x.name)} /> {x.name}</label>)}</div></details>
              <button className="btn" type="submit" data-confirm="Save what this provider is approved for?" data-confirm-body="Services and states taken away are switched off for it straight away. Its past work is kept." data-confirm-ok="Save" data-confirm-tone="default">Save</button>
            </form>
          </section>
          <section className="card stack"><h2>{pr.suspendedAt ? "Lift the suspension" : "Suspend"}</h2>
            <form action={suspendAction} className="stack"><input type="hidden" name="id" value={pr.id} /><input type="hidden" name="suspend" value={pr.suspendedAt ? "no" : "yes"} />
              {pr.suspendedAt ? null : <Field label="Reason" hint="Its owners and administrators see this"><textarea name="reason" required minLength={10} maxLength={1500} rows={3} /></Field>}
              <button className={`btn ${pr.suspendedAt ? "" : "danger"}`} type="submit" data-confirm={pr.suspendedAt ? "Lift the suspension?" : "Suspend this provider?"} data-confirm-body={pr.suspendedAt ? "It can take on work and make changes again." : "It can take on no new work and change nothing. Its records, reports and money owed are kept."} data-confirm-ok={pr.suspendedAt ? "Lift it" : "Suspend"} data-confirm-tone={pr.suspendedAt ? "default" : undefined}>{pr.suspendedAt ? "Lift the suspension" : "Suspend"}</button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
