import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { salesDashboard, type Figures } from "@/lib/services/sales";
import { can } from "@/lib/permissions";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { ShowMore, TableMore } from "@/components/ui";

export const metadata = { title: "Sales dashboard" };

const line = (f: Figures) => `${f.openLeads} open leads · ${f.openDeals} deals in progress (${formatKobo(f.pipelineKobo)}) · ${f.completedDeals} completed (${formatKobo(f.completedKobo)})`;

export default async function SalesPage() {
  const member = await requireMember("crm.view");
  const d = await salesDashboard(member);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Sales dashboard</h1>
        <p className="muted">{d.scope === "company" ? "The whole company." : d.scope === "team" ? "You and your team." : "Your own work."} <Link href="/app/crm">Clients and leads</Link> · <Link href="/app/deals">Deals</Link> · <Link href="/app/commissions">Commissions</Link>{can(member.role, "crm.report") ? <> · <Link href="/app/sales/reports">Company reports</Link></> : null}</p>
      </div>

      <section className="stats" aria-label="Your figures">
        <div className="stat"><b>{d.me.openLeads}</b><span>Your open leads</span></div>
        <div className="stat"><b>{d.me.openDeals}</b><span>Your deals in progress</span></div>
        <div className="stat"><b>{d.me.completedDeals}</b><span>Your completed deals</span></div>
        <div className="stat"><b>{formatKobo(d.me.commissionApprovedKobo)}</b><span>Your commission approved</span></div>
        <div className="stat"><b>{formatKobo(d.me.commissionPaidKobo)}</b><span>Of which paid</span></div>
      </section>

      {d.scope !== "self" ? (
        <section className="card">
          <h2>{d.scope === "company" ? "Company" : "Team"} total</h2>
          <p>{line(d.total)}</p>
          <p className="small muted">{d.total.convertedLeads} leads became deals, {d.total.lostLeads} were lost, {d.total.cancelledDeals} deals were cancelled. Lead to deal rate {(d.conversionBps / 100).toFixed(1)}%.</p>
        </section>
      ) : null}

      {d.branches.length > 0 ? (
        <section className="card">
          <h2>Branches</h2>
          <ShowMore noun="more branches" limit={4} items={d.branches.map((b) => <li key={b.id}><div><strong>{b.name}</strong> <span className="small muted">{b.people} {b.people === 1 ? "person" : "people"}</span><div className="small muted">{line(b.f)}</div></div></li>)} />
        </section>
      ) : null}

      {d.teams.length > 0 ? (
        <section className="card">
          <h2>Teams</h2>
          <ShowMore noun="more teams" limit={4} items={d.teams.map((t) => <li key={t.id}><div><strong>{t.name}</strong> <span className="small muted">{t.people} {t.people === 1 ? "person" : "people"}</span><div className="small muted">{line(t.f)}</div></div></li>)} />
        </section>
      ) : null}

      {d.scope !== "self" ? (
        <section className="card">
          <h2>People</h2>
          <TableMore limit={8} noun="more people"
            head={<tr><th>Name</th><th>Open leads</th><th>Deals in progress</th><th>Completed</th><th>Completed value</th><th>Commission paid</th></tr>}
            rows={d.agents.map((a) => <tr key={a.id}><td>{a.name}<div className="small muted">{humanize(a.role)}</div></td><td>{a.f.openLeads}</td><td>{a.f.openDeals}</td><td>{a.f.completedDeals}</td><td>{formatKobo(a.f.completedKobo)}</td><td>{formatKobo(a.f.commissionPaidKobo)}</td></tr>)} />
        </section>
      ) : null}
    </div>
  );
}
