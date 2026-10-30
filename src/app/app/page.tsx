import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { dashboard } from "@/lib/services/dashboard";
import { correspondenceSummary } from "@/lib/services/correspondence";
import { expiringDocuments, overdueFileCount } from "@/lib/services/files";
import { complianceCalendar } from "@/lib/services/obligations";
import { workOverview } from "@/lib/services/work-overview";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Flash, ShowMore, sp, type SP } from "@/components/ui";
import { companyTrust } from "@/lib/services/kyc";
import { TrustBadge } from "@/components/TrustBadge";
import { myPromoEntries } from "@/lib/services/promotions";
import { companyTemplate } from "@/lib/services/industry-setup";
import { todayInLagos } from "@/lib/dates";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember();
  const [d, corr, filesOverdue, expiring, calendar, work, trust] = await Promise.all([
    dashboard(member), correspondenceSummary(member), overdueFileCount(member), expiringDocuments(member, 60), complianceCalendar(member), workOverview(member), companyTrust(member.companyId),
  ]);
  // Promotions: only people who manage listings see them, here on the dashboard rather than on the public home page.
  const promos = can(member.role, "listing.manage") ? await myPromoEntries(member).catch(() => []) : null;
  const today = todayInLagos();
  const livePromos = (promos ?? []).filter((e) => e.status === "APPROVED" && e.campaign.active && e.campaign.startsOn <= today && e.campaign.endsOn >= today);
  const waitingPromos = (promos ?? []).filter((e) => e.status === "REQUESTED").length;
  const template = await companyTemplate(member).catch(() => null);
  const escalated = calendar.items.filter((i) => i.state === "ESCALATED").length;
  const overdueDeadlines = calendar.items.filter((i) => i.state === "OVERDUE").length;
  const dueSoon = calendar.items.filter((i) => i.state === "DUE_SOON").length;
  const s = (k: string) => d.statusCounts[k] ?? 0;

  return (
    <div className="stack-lg">
      <div className="row between">
        <h1>Dashboard</h1>
        {can(member.role, "asset.create") ? <Link className="btn primary" href="/app/assets/new">Register an asset</Link> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {trust.level < 2 ? (
        <div className="card row between" role="note">
          <span className="row"><TrustBadge t={trust} /> <span className="small">Verified companies get a badge on every listing and profile. {can(member.role, "kyc.manage") ? "Complete the checks to earn it." : "Ask your company administrator to complete the checks."}</span></span>
          {can(member.role, "kyc.manage") ? <Link className="btn primary" href="/app/verification">Verify the company</Link> : null}
        </div>
      ) : null}

      {can(member.role, "settings.manage") && !template ? (
        <div className="card promo-status on">
          <div className="promo-status-text"><p className="eyebrow">Get started</p><strong>Set up the workspace for your kind of business</strong><span className="small muted">Letting agency, brokerage, developer, facility manager or institution: departments, checklists, reminders and commission rules, in a minute.</span></div>
          <a className="btn primary" href="/app/setup">Choose your set-up</a>
        </div>
      ) : template ? (
        <details className="card inline">
          <summary>First steps as a {template.name.toLowerCase()}</summary>
          <ol className="first-steps">{template.firstSteps.map((f) => <li key={f.label}><a href={f.href}>{f.label}</a></li>)}</ol>
        </details>
      ) : null}

      {promos ? (
        <div className={`card promo-status${livePromos.length ? " on" : ""}`}>
          <div className="promo-status-text">
            <p className="eyebrow">Promotions</p>
            {livePromos.length ? (
              <><strong>{livePromos.length} {livePromos.length === 1 ? "property is" : "properties are"} on promotion</strong>
                <span className="small muted">{livePromos.slice(0, 3).map((e) => `${e.listing?.title ?? "A listing"} (${e.campaign.name}, ends ${formatDate(e.campaign.endsOn)})`).join(" · ")}{livePromos.length > 3 ? ` and ${livePromos.length - 3} more` : ""}</span></>
            ) : (
              <><strong>No promotion running</strong>
                <span className="small muted">{waitingPromos ? `${waitingPromos} request${waitingPromos === 1 ? " is" : "s are"} waiting for approval. ` : ""}A promotion shows your listing on the home page with the saving and end date.</span></>
            )}
          </div>
          <Link className={`btn${livePromos.length ? "" : " primary"}`} href="/app/promotions">{livePromos.length ? "Manage promotions" : "Run a promotion"}</Link>
        </div>
      ) : null}

      <section className="stats" aria-label="Portfolio summary">
        <div className="stat"><b>{d.totalAssets}</b><span>Assets registered</span></div>
        <div className="stat"><b>{s("OCCUPIED")}</b><span>Occupied</span></div>
        <div className="stat"><b>{s("VACANT")}</b><span>Vacant</span></div>
        <div className={`stat${d.overdueCharges ? " alert" : ""}`}>
          <b>{formatKobo(d.overdueKobo)}</b><span>Overdue rent ({d.overdueCharges} charges)</span>
        </div>
        <div className={`stat${d.overdueTasks ? " alert" : ""}`}>
          <b>{d.openTasks}</b><span>Open tasks ({d.overdueTasks} overdue)</span>
        </div>
        <div className="stat"><b>{d.enquiries30d}</b><span>Enquiries, last 30 days</span></div>
      </section>

      <details className="inline more-figures">
        <summary>More figures: letters, deadlines, files, projects</summary>
      <section className="stats" aria-label="Administration alerts">
        <Link href="/app/correspondence?view=overdue" className={`stat${corr.overdue ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{corr.overdue}</b><span>Overdue correspondence replies</span>
        </Link>
        <Link href="/app/correspondence?view=unassigned" className="stat" style={{ textDecoration: "none" }}>
          <b>{corr.unassigned}</b><span>Unassigned letters</span>
        </Link>
        <Link href="/app/correspondence?view=mine" className="stat" style={{ textDecoration: "none" }}>
          <b>{corr.mine}</b><span>Letters assigned to me</span>
        </Link>
        <Link href="/app/compliance" className={`stat${escalated ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{escalated}</b><span>Escalated deadlines (overdue {calendar.escalationDays}+ days)</span>
        </Link>
        <Link href="/app/compliance" className={`stat${overdueDeadlines ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{overdueDeadlines}</b><span>Overdue deadlines</span>
        </Link>
        <Link href="/app/compliance" className="stat" style={{ textDecoration: "none" }}>
          <b>{dueSoon}</b><span>Deadlines due in {calendar.leadDays} days</span>
        </Link>
        <Link href="/app/files?view=overdue" className={`stat${filesOverdue ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{filesOverdue}</b><span>Files overdue for return</span>
        </Link>
        <Link href="/app/files" className={`stat${expiring.length ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{expiring.length}</b><span>Documents expiring within 60 days</span>
        </Link>
      </section>

      {work ? (
        <section className="stack" aria-label="Projects and valuations">
          <h2>Projects and valuations</h2>
          <div className="stats">
            {work.projects ? (
              <>
                <Link href="/app/projects" className="stat" style={{ textDecoration: "none" }}><b>{work.projects.active}</b><span>Active projects ({work.projects.planning} in planning)</span></Link>
                <Link href="/app/projects" className={`stat${work.projects.completionForMe ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{work.projects.completionForMe}</b><span>Completions waiting for my approval</span></Link>
                <Link href="/app/projects" className={`stat${work.projects.overdueDefects ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{work.projects.overdueDefects}</b><span>Overdue defects ({work.projects.openDefects} open)</span></Link>
                <Link href="/app/projects" className={`stat${work.projects.lateProcurement ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{work.projects.lateProcurement}</b><span>Materials late</span></Link>
              </>
            ) : null}
            {work.valuations ? (
              <Link href="/app/valuations" className={`stat${work.valuations.overdue ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{work.valuations.inReview}</b><span>Valuations in review ({work.valuations.overdue} overdue)</span></Link>
            ) : null}
          </div>
          {work.projects ? (
            <details className="inline">
              <summary>More project figures</summary>
              <div className="stats">
                <Link href="/app/projects" className={`stat${work.projects.overBudget ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{work.projects.overBudget}</b><span>Forecast over budget</span></Link>
                <Link href="/app/projects" className={`stat${work.projects.highRisks ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{work.projects.highRisks}</b><span>High risks</span></Link>
                <Link href="/app/projects" className={`stat${work.projects.failedChecks ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{work.projects.failedChecks}</b><span>Failed quality checks</span></Link>
                <Link href="/app/compliance" className="stat" style={{ textDecoration: "none" }}><b>{work.projects.warrantiesEnding}</b><span>Warranties ending within 60 days</span></Link>
                <Link href="/app/projects" className="stat" style={{ textDecoration: "none" }}><b>{work.projects.completionWaiting}</b><span>Completion requests open</span></Link>
              </div>
            </details>
          ) : null}
        </section>
      ) : null}
      </details>

      <div className="two">
        <section className="card">
          <h2>Recent activity</h2>
          {d.recent.length === 0 ? (
            <p className="muted">Nothing yet. Register your first asset to get started.</p>
          ) : (
            <ShowMore noun="more" limit={5} items={d.recent.map((r) => (
                <li key={r.id}>
                  <div>
                    <div>{humanize(r.action.replace(".", " "))}</div>
                    <div className="small muted">{formatDateTime(r.createdAt)}</div>
                  </div>
                </li>
              ))} />
          )}
        </section>
        <section className="card">
          <h2>Leases ending in 90 days</h2>
          {d.expiring.length === 0 ? (
            <p className="muted">No leases end in the next 90 days.</p>
          ) : (
            <ShowMore noun="more" limit={5} items={d.expiring.map((l) => (
                <li key={l.id}>
                  <div>
                    <Link href={`/app/assets/${l.asset.id}`}>{l.asset.name}</Link>
                    <div className="small muted">{l.ref} · {l.occupantName} · ends {formatDate(l.endDate)}</div>
                  </div>
                </li>
              ))} />
          )}
        </section>
      </div>
    </div>
  );
}
