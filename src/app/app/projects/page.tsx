import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listProjects, PROJECT_KINDS } from "@/lib/services/project";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createProjectAction } from "./actions";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("project.view");
  const d = await listProjects(member);
  const active = d.rows.filter((r) => r.project.status === "ACTIVE");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Projects</h1>
        <p className="muted">Plan construction and renovation work, hold spending to an approved budget, and track cost and progress.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Project summary">
        <div className="stat"><b>{active.length}</b><span>Active</span></div>
        <div className="stat"><b>{d.rows.filter((r) => r.project.status === "PLANNING").length}</b><span>In planning</span></div>
        <div className="stat"><b>{active.filter((r) => r.cost?.overBudget).length}</b><span>Forecast over budget</span></div>
        <div className="stat"><b>{active.reduce((a, r) => a + r.late, 0)}</b><span>Late or behind packages</span></div>
      </section>
      <section className="card">
        <h2>All projects</h2>
        {d.rows.length === 0 ? <p className="muted">No projects yet.</p> : (
          <ShowMore noun="more projects" limit={8} items={d.rows.map((r) => (
            <li key={r.project.id}><div className="row between" style={{ width: "100%" }}>
              <div>
                <Link href={`/app/projects/${r.project.id}`}><strong>{r.project.ref}</strong></Link> · {r.project.title}
                <div className="small muted">{r.project.asset.ref} {r.project.asset.name} · {humanize(r.project.kind)} · {formatDate(r.project.plannedStart)} to {formatDate(r.project.plannedEnd)}</div>
                <div className="small muted">{r.progress}% complete{r.cost ? ` · budget ${formatKobo(r.cost.budgetKobo)} · forecast ${formatKobo(r.cost.forecastKobo)}` : ""}</div>
              </div>
              <div className="row">{r.cost?.overBudget ? <Pill status="OVERDUE" label="Over budget" /> : null}{r.late > 0 ? <Pill status="HIGH" label={`${r.late} late`} /> : null}<Pill status={r.project.status} label={humanize(r.project.status)} /></div>
            </div></li>
          ))} />
        )}
      </section>
      {can(member.role, "project.manage") ? (
        <section className="card">
          <details className="inline">
            <summary>New project</summary>
            <form action={createProjectAction} className="stack">
              <div className="fields">
                <Field label="Asset"><select name="assetId" required defaultValue=""><option value="" disabled>Choose an asset</option>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
                <Field label="Title"><input name="title" required /></Field>
                <Field label="Type"><select name="kind" defaultValue="RENOVATION"><EnumOptions values={PROJECT_KINDS} /></select></Field>
                <Field label="Project manager"><select name="managerId" defaultValue=""><option value="">Not yet assigned</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                <Field label="Planned start"><input name="plannedStart" type="date" required /></Field>
                <Field label="Planned end"><input name="plannedEnd" type="date" required /></Field>
                <Field label="Contingency (₦)" hint="A reserve inside the budget for overruns."><input name="contingency" inputMode="decimal" /></Field>
              </div>
              <Field label="Description"><textarea name="description" rows={3} /></Field>
              <button className="btn primary" type="submit">Create project</button>
            </form>
          </details>
        </section>
      ) : null}
    </div>
  );
}
