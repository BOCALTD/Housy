import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listMaintenance, PRIORITIES, RISKS } from "@/lib/services/maintenance";
import { inventorySummary } from "@/lib/services/inventory";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { generateAction, reportWorkOrderAction } from "./actions";

export const metadata = { title: "Maintenance" };

export default async function MaintenancePage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const [d, inv] = await Promise.all([listMaintenance(member), inventorySummary(member)]);
  const urgent = (w: (typeof d.open)[number]) => w.priority === "EMERGENCY" || w.safetyRisk || w.riskLevel === "CRITICAL";
  const groups: { title: string; items: typeof d.open; empty: string }[] = [
    { title: "Needs triage or approval", items: d.open.filter((w) => w.status === "REPORTED" || w.status === "TRIAGED"), empty: "Nothing is waiting." },
    { title: "Approved, waiting for assignment", items: d.open.filter((w) => w.status === "APPROVED"), empty: "Nothing is waiting." },
    { title: "In hand", items: d.open.filter((w) => ["ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED"].includes(w.status)), empty: "No work in progress." },
    { title: "Completed, waiting for verification", items: d.open.filter((w) => w.status === "COMPLETED"), empty: "Nothing to verify." },
  ];
  const row = (w: (typeof d.open)[number]) => {
    const late = w.targetDate && w.targetDate < d.today;
    return (
      <li key={w.id}>
        <div className="row between" style={{ width: "100%" }}>
          <div>
            <Link href={`/app/maintenance/${w.id}`}><strong>{w.ref}</strong></Link> · {w.title}
            <div className="small muted">
              {w.asset.name} · {humanize(w.status)}{w.targetDate ? ` · target ${formatDate(w.targetDate)}` : ""}
              {w.assigneeId ? ` · ${d.names[w.assigneeId] ?? "officer"}` : ""}{w.contractor ? ` · ${w.contractor.name}` : ""}
            </div>
          </div>
          <div className="row">
            {urgent(w) ? <Pill status="OVERDUE" label={w.priority === "EMERGENCY" ? "Emergency" : w.safetyRisk ? "Safety risk" : "Critical"} /> : null}
            {late ? <Pill status="OVERDUE" label="Overdue" /> : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="stack-lg">
      <div className="row between">
        <div className="stack" style={{ gap: 6 }}>
          <h1>Maintenance</h1>
          <p className="muted">Work orders move from reported to closed. Cost approval and completion checks are done by different people.</p>
        </div>
        <div className="row">
          <Link className="btn" href="/app/maintenance/schedules">Recurring jobs</Link>
          <Link className="btn" href="/app/maintenance/contractors">Contractors</Link>
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Maintenance summary">
        <div className="stat"><b>{d.open.length}</b><span>Open work orders</span></div>
        <div className={`stat${d.overdue.length ? " alert" : ""}`}><b>{d.overdue.length}</b><span>Past their target date</span></div>
        <div className={`stat${d.open.filter(urgent).length ? " alert" : ""}`}><b>{d.open.filter(urgent).length}</b><span>Emergency, critical or safety</span></div>
        <div className="stat"><b>{groups[3].items.length}</b><span>Waiting for verification</span></div>
        <div className={`stat${d.unattendedUrgent ? " alert" : ""}`}><b>{d.unattendedUrgent}</b><span>Urgent and not yet in hand</span></div>
        <div className="stat"><b>{formatKobo(d.spentThisYearKobo)}</b><span>Spent on closed work this year</span></div>
      </section>
      <section className="stats" aria-label="Inventory summary">
        <div className="stat"><b><Link href="/app/inventory">{inv.items}</Link></b><span>Inventory items</span></div>
        <div className={`stat${inv.lowStock ? " alert" : ""}`}><b>{inv.lowStock}</b><span>Running low</span></div>
        <div className={`stat${inv.pendingAdjustments ? " alert" : ""}`}><b>{inv.pendingAdjustments}</b><span>Stock changes awaiting approval</span></div>
        <div className="stat"><b><Link href="/app/inventory/counts">{inv.openCounts}</Link></b><span>Counts in progress</span></div>
      </section>
      {can(member.role, "maintenance.manage") ? (
        <form action={generateAction}><button className="btn" type="submit">Create work orders that are due from recurring jobs</button></form>
      ) : null}
      {groups.map((g) => (
        <section key={g.title} className="card"><h2>{g.title}</h2>{g.items.length === 0 ? <p className="muted small">{g.empty}</p> : <ul className="timeline">{g.items.map(row)}</ul>}</section>
      ))}
      <section className="card">
        <h2>Recently finished</h2>
        {d.closed.length === 0 ? <p className="muted small">None yet.</p> : (
          <ul className="timeline">
            {d.closed.map((w) => <li key={w.id}><div><Link href={`/app/maintenance/${w.id}`}>{w.ref}</Link> · {w.title}<div className="small muted">{w.asset.name} · {humanize(w.status)}</div></div></li>)}
          </ul>
        )}
      </section>
      {can(member.role, "maintenance.request") ? (
        <section className="card" aria-labelledby="new-h">
          <h2 id="new-h">Report a problem</h2>
          {d.assets.length === 0 ? <p className="muted">Register an asset first.</p> : (
            <form action={reportWorkOrderAction} className="stack">
              <div className="fields">
                <Field label="Asset"><select name="assetId" required defaultValue={sp(searchParams, "assetId") ?? ""}>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
                <Field label="Reported by (tenant or caller)"><input name="requesterName" /></Field>
              </div>
              <Field label="What is wrong"><input name="title" required /></Field>
              <Field label="Details"><textarea name="description" rows={3} /></Field>
              <div className="fields">
                <Field label="Priority" hint="Emergency work can start before approval."><select name="priority" defaultValue="NORMAL"><EnumOptions values={PRIORITIES} /></select></Field>
                <Field label="Risk"><select name="riskLevel" defaultValue="LOW"><EnumOptions values={RISKS} /></select></Field>
                <Field label="Target date"><input name="targetDate" type="date" /></Field>
              </div>
              <label className="row" style={{ gap: 8 }}><input type="checkbox" name="safetyRisk" /> This is a safety risk</label>
              <Field label="Estimated cost (₦)"><input name="estimatedCost" inputMode="decimal" /></Field>
              <button className="btn primary" type="submit">Raise work order</button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
