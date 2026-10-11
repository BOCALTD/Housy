import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reviewQueue } from "@/lib/services/listings";
import { verificationMetrics } from "@/lib/services/verification";
import { formatKobo } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { EnumOptions, Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { approveListingAction, leadStatusAction, rejectListingAction, saveProviderAction } from "./actions";

export const metadata = { title: "Platform admin" };
export const dynamic = "force-dynamic";

function pct(a: number, b: number) {
  return b ? `${((a / b) * 100).toFixed(1)}%` : "—";
}

export default async function AdminPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const [queue, metrics, providers, leads] = await Promise.all([
    reviewQueue(admin.id),
    verificationMetrics(),
    prisma.serviceProvider.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.providerLead.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { provider: { select: { shortName: true } } } }),
  ]);

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 4 }}>
        <p className="eyebrow">Platform Super Super Admin</p>
        <h1>Platform administration</h1>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card">
        <h2>Listings awaiting review ({queue.length})</h2>
        {queue.length === 0 ? <p className="muted">No listings are waiting for review.</p> : (
          <div className="stack">
            {queue.map((l) => (
              <div key={l.id} className="stack" style={{ gap: 8, borderBottom: "1px solid var(--line)", paddingBottom: 14 }}>
                <div className="row between">
                  <div>
                    <strong>{l.title}</strong> <span className="mono small muted">{l.publicRef}</span>
                    <div className="small muted">{l.companyName} · {humanize(l.purpose)} · {formatKobo(l.priceKobo)} · {l.city}, {l.state}</div>
                  </div>
                </div>
                {l.description ? <p className="small" style={{ maxWidth: "70ch" }}>{l.description}</p> : null}
                <form action={approveListingAction} className="row">
                  <input type="hidden" name="listingId" value={l.id} />
                  <input name="note" placeholder="Review note (required to reject)" aria-label="Review note"
                         style={{ flex: "1 1 240px", border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" }} />
                  <button className="btn" formAction={rejectListingAction} type="submit">Return to company</button>
                  <button className="btn primary" type="submit">Approve and publish</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card table-wrap">
        <h2>Verification recommendations</h2>
        <table>
          <thead><tr><th>Metric</th><th className="r">Count</th><th>Rate</th></tr></thead>
          <tbody>
            <tr><td>Modal impressions</td><td className="r">{metrics.impressions}</td><td></td></tr>
            <tr><td className="muted">Shown with Yes preselected (never counted as interest)</td><td className="r muted">{metrics.preselectedShown}</td><td className="muted small">Every impression</td></tr>
            <tr><td>Confirmed interest</td><td className="r">{metrics.confirmedInterest}</td><td>{pct(metrics.confirmedInterest, metrics.impressions)} of impressions</td></tr>
            <tr><td>Not interested</td><td className="r">{metrics.declined}</td><td>{pct(metrics.declined, metrics.impressions)}</td></tr>
            <tr><td>Maybe later or closed</td><td className="r">{metrics.later}</td><td>{pct(metrics.later, metrics.impressions)}</td></tr>
            <tr><td>Requests submitted with consent</td><td className="r">{metrics.leads}</td><td>{pct(metrics.leads, metrics.confirmedInterest)} of confirmed interest</td></tr>
            <tr><td>Provider follow-ups</td><td className="r">{metrics.followedUp}</td><td>{pct(metrics.followedUp, metrics.leads)} of requests</td></tr>
          </tbody>
        </table>
      </section>

      <section className="card table-wrap" id="leads">
        <h2>Verification requests</h2>
        {leads.length === 0 ? <p className="muted">No requests yet.</p> : (
          <table>
            <thead><tr><th>Ref</th><th>Provider</th><th>Property</th><th>Requester</th><th>Received</th><th>Status</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.ref}</td>
                  <td>{l.provider.shortName}</td>
                  <td className="mono">{l.listingRef}</td>
                  <td>{l.name}<div className="small muted">{humanize(l.contactMethod)}: {l.contactValue}</div></td>
                  <td className="small">{formatDateTime(l.createdAt)}</td>
                  <td>
                    {l.status === "WITHDRAWN" ? <Pill status="WITHDRAWN" /> : (
                      <form action={leadStatusAction} className="row">
                        <input type="hidden" name="leadId" value={l.id} />
                        <select name="status" defaultValue={l.status} aria-label={`Status for ${l.ref}`}>
                          <EnumOptions values={["SUBMITTED", "CONTACTED", "IN_PROGRESS", "CLOSED", "DECLINED"]} />
                        </select>
                        <button className="btn small" type="submit">Save</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card stack" id="providers">
        <h2>Verification providers</h2>
        <p className="small muted">Show only approved, verified information. Use Affiliated when the provider shares owners or directors with the platform operator.</p>
        {[...providers, null].map((p) => (
          <details key={p?.id ?? "new"} className="inline" open={providers.length === 0 && !p}>
            <summary>
              {p ? <>{p.name} <Pill status={p.status} /> <span className="pill disc">{humanize(p.placement)}</span>{p.featured ? <span className="pill brand">Featured</span> : null}</> : "Add a provider"}
            </summary>
            <form action={saveProviderAction} className="stack">
              <input type="hidden" name="id" value={p?.id ?? ""} />
              <div className="fields">
                <Field label="Company name"><input name="name" required defaultValue={p?.name ?? ""} /></Field>
                <Field label="Short name" hint="Shown on the logo tile."><input name="shortName" required maxLength={12} defaultValue={p?.shortName ?? ""} /></Field>
              </div>
              <Field label="Approved profile"><textarea name="profile" rows={3} defaultValue={p?.profile ?? ""} /></Field>
              <Field label="Services" hint="One per line."><textarea name="services" rows={3} defaultValue={p?.services ?? ""} /></Field>
              <div className="fields">
                <Field label="Coverage areas"><input name="coverage" defaultValue={p?.coverage ?? ""} /></Field>
                <Field label="Profile link"><input name="link" placeholder="https://" defaultValue={p?.link ?? ""} /></Field>
              </div>
              <div className="fields">
                <Field label="Approval"><select name="status" defaultValue={p?.status ?? "PENDING"}><EnumOptions values={["PENDING", "APPROVED", "SUSPENDED"]} /></select></Field>
                <Field label="Placement label"><select name="placement" defaultValue={p?.placement ?? "EDITORIAL"}><EnumOptions values={["SPONSORED", "AFFILIATED", "EDITORIAL"]} /></select></Field>
              </div>
              <label className="check"><input type="checkbox" name="featured" defaultChecked={p?.featured ?? false} /><span>Featured provider in the buyer modal</span></label>
              <div className="row"><button className="btn primary" type="submit">Save provider</button></div>
            </form>
          </details>
        ))}
      </section>
    </div>
  );
}
