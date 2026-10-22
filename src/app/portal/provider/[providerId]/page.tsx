import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { providerLeads } from "@/lib/services/portals";
import { LEAD_STATUS_LABELS, leadNext, type LeadStatus } from "@/lib/portal-rules";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { MoreMenu } from "@/components/MoreMenu";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { providerLeadAction } from "../../actions";

export const metadata = { title: "Provider portal", robots: { index: false } };
export const dynamic = "force-dynamic";

const FILTERS: LeadStatus[] = ["SUBMITTED", "CONTACTED", "IN_PROGRESS", "CLOSED", "DECLINED", "WITHDRAWN"];

export default async function ProviderPortal({ params, searchParams }: { params: Promise<{ providerId: string }>; searchParams?: Promise<SP> }) {
  const { providerId } = await params;
  const s = await searchParams;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(providerId)) notFound();
  const raw = sp(s, "status");
  const status = raw && (FILTERS as string[]).includes(raw) ? (raw as LeadStatus) : null;
  const data = await providerLeads(user.id, providerId, status);
  if (!data) notFound();
  const { provider, leads, counts } = data;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="stack-lg">
      <div className="portal-head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">Provider portal</p>
          <h1>{provider.name}</h1>
          <p className="muted small">Requests from people who chose to contact {provider.shortName} about a property. Only what they agreed to share is shown. Use it for their request and nothing else.</p>
        </div>
        <Link className="btn" href="/portal">All portals</Link>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <nav className="nav workspace-nav" aria-label="Filter requests">
        <Link className="tap" href={`/portal/provider/${provider.id}`} aria-current={!status ? "page" : undefined}>All ({total})</Link>
        {FILTERS.slice(0, 3).map((f) => <Link key={f} className="tap" href={`/portal/provider/${provider.id}?status=${f}`} aria-current={status === f ? "page" : undefined}>{LEAD_STATUS_LABELS[f]} ({counts[f] ?? 0})</Link>)}
        <MoreMenu label="More">
          {FILTERS.slice(3).map((f) => <Link key={f} href={`/portal/provider/${provider.id}?status=${f}`} aria-current={status === f ? "page" : undefined}>{LEAD_STATUS_LABELS[f]} ({counts[f] ?? 0})</Link>)}
        </MoreMenu>
      </nav>
      {leads.length === 0 ? <section className="card"><p className="muted">No requests{status ? " with this status" : " yet"}.</p></section> : (
        <ShowMore limit={10} noun="more requests" items={leads.map((l) => {
          const next = leadNext(l.status as LeadStatus);
          return (
            <li key={l.id} className="card stack lead-card">
              <div className="row between wrap"><strong>{l.ref}</strong><Pill status={l.status === "SUBMITTED" ? "OPEN" : l.status === "CLOSED" || l.status === "IN_PROGRESS" || l.status === "CONTACTED" ? "ACTIVE" : "SUSPENDED"} label={LEAD_STATUS_LABELS[l.status as LeadStatus]} /></div>
              <dl className="small">
                <dt className="muted">Name</dt><dd>{l.name}</dd>
                <dt className="muted">Contact</dt><dd>{l.status === "WITHDRAWN" ? "Removed when they withdrew" : `${humanize(l.contactMethod)}: ${l.contactValue}`}</dd>
                <dt className="muted">Property</dt><dd><Link className="tap" href={`/properties/${l.listingRef}`}>{l.listingRef}</Link></dd>
                <dt className="muted">Received</dt><dd>{formatDateTime(l.createdAt)}</dd>
                {l.note ? <><dt className="muted">Their note</dt><dd>{l.note}</dd></> : null}
                {l.providerNote ? <><dt className="muted">Your last note</dt><dd>{l.providerNote}</dd></> : null}
              </dl>
              {next.length ? (
                <form action={providerLeadAction} className="row wrap">
                  <input type="hidden" name="providerId" value={provider.id} /><input type="hidden" name="ref" value={l.ref} />
                  <select name="status" aria-label={`New status for ${l.ref}`} defaultValue={next[0]}>{next.map((n) => <option key={n} value={n}>{LEAD_STATUS_LABELS[n]}</option>)}</select>
                  <input name="note" placeholder="Note for the person (optional)" aria-label="Note for the person" maxLength={1000} style={{ flex: "1 1 200px" }} />
                  <button className="btn primary" type="submit">Update</button>
                </form>
              ) : null}
            </li>
          );
        })} />
      )}
    </div>
  );
}
