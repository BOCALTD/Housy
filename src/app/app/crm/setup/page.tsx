import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { getCrmSetup } from "@/lib/services/crm";
import { humanize } from "@/lib/labels";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { addBranchAction, addSourceAction, addTeamAction, placementAction, sourceActiveAction, teamLeadAction } from "../actions";

export const metadata = { title: "Sales setup" };

export default async function CrmSetupPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("crm.configure");
  const d = await getCrmSetup(member);
  const leaders = d.members.filter((m) => m.role !== "VIEWER" && m.role !== "OFFICER");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Sales setup</h1><p className="muted">Lead sources, branches and teams. A team lead can see the clients and leads of the people on their team. <Link href="/app/crm">Back to overview</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        <h2>Lead sources</h2>
        <ShowMore noun="more sources" limit={6} items={d.sources.map((s) => (
          <li key={s.id}><div className="row between" style={{ width: "100%" }}><span>{s.name}{s.active ? "" : " (not in use)"}</span>
            <form action={sourceActiveAction}><input type="hidden" name="sourceId" value={s.id} /><input type="hidden" name="active" value={s.active ? "no" : "yes"} /><button className="btn" type="submit">{s.active ? "Stop using" : "Use again"}</button></form></div></li>))} />
        <details className="inline"><summary>Add a source</summary><form action={addSourceAction} className="stack"><Field label="Name"><input name="name" required /></Field><button className="btn primary" type="submit">Add</button></form></details>
      </section>
      <section className="card">
        <h2>Branches</h2>
        {d.branches.length === 0 ? <p className="muted">No branches yet.</p> : <ShowMore noun="more branches" limit={6} items={d.branches.map((b) => <li key={b.id}>{b.code} · {b.name}</li>)} />}
        <details className="inline"><summary>Add a branch</summary><form action={addBranchAction} className="stack"><div className="fields"><Field label="Name"><input name="name" required /></Field><Field label="Code" hint="2 to 8 letters or digits"><input name="code" required /></Field></div><button className="btn primary" type="submit">Add</button></form></details>
      </section>
      <section className="card">
        <h2>Teams</h2>
        {d.teams.length === 0 ? <p className="muted">No teams yet.</p> : (
          <ShowMore noun="more teams" limit={5} items={d.teams.map((t) => (
            <li key={t.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <strong>{t.name}</strong>
              <div className="small muted">{d.branches.find((b) => b.id === t.branchId)?.name ?? "No branch"} · lead {leaders.find((m) => m.id === t.leadId)?.name ?? "none"}</div>
              <details className="inline"><summary>Change lead</summary><form action={teamLeadAction} className="stack"><input type="hidden" name="teamId" value={t.id} />
                <select name="leadId" defaultValue={t.leadId ?? ""}><option value="">No lead</option>{leaders.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button className="btn primary" type="submit">Save</button></form></details>
            </div></li>))} />
        )}
        <details className="inline"><summary>Add a team</summary><form action={addTeamAction} className="stack"><div className="fields">
          <Field label="Name"><input name="name" required /></Field>
          <Field label="Branch"><select name="branchId" defaultValue=""><option value="">None</option>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Lead"><select name="leadId" defaultValue=""><option value="">None</option>{leaders.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field></div>
          <button className="btn primary" type="submit">Add</button></form></details>
      </section>
      <section className="card">
        <h2>People</h2>
        <ShowMore noun="more people" limit={5} items={d.members.map((m) => (
          <li key={m.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
            <div><strong>{m.name}</strong> <span className="small muted">{humanize(m.role)} · {d.branches.find((b) => b.id === m.branchId)?.name ?? "no branch"} · {d.teams.find((t) => t.id === m.teamId)?.name ?? "no team"}</span></div>
            <details className="inline"><summary>Place</summary><form action={placementAction} className="stack"><input type="hidden" name="membershipId" value={m.id} /><div className="fields">
              <Field label="Branch"><select name="branchId" defaultValue={m.branchId ?? ""}><option value="">None</option>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Team"><select name="teamId" defaultValue={m.teamId ?? ""}><option value="">None</option>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></div>
              <button className="btn primary" type="submit">Save</button></form></details>
          </div></li>))} />
      </section>
    </div>
  );
}
