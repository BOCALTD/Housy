import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listClients, CLIENT_KINDS } from "@/lib/services/crm";
import { can } from "@/lib/permissions";
import { humanize } from "@/lib/labels";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createClientAction } from "../actions";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("crm.view");
  const q = sp(searchParams, "q") ?? "";
  const archived = sp(searchParams, "archived") === "1";
  const d = await listClients(member, { q, archived, mine: sp(searchParams, "mine") === "1" });
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Clients</h1><p className="muted"><Link href="/app/crm">Back to overview</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        <form className="row" method="get">
          <input name="q" defaultValue={q} placeholder="Name, reference, email or phone" aria-label="Search clients" />
          <label className="row"><input type="checkbox" name="mine" value="1" defaultChecked={sp(searchParams, "mine") === "1"} /> Mine only</label>
          <label className="row"><input type="checkbox" name="archived" value="1" defaultChecked={archived} /> Archived</label>
          <button className="btn" type="submit">Search</button>
        </form>
        {d.rows.length === 0 ? <p className="muted">No clients found.</p> : (
          <ShowMore noun="more clients" limit={10} items={d.rows.map((c) => (
            <li key={c.id}><div className="row between" style={{ width: "100%" }}>
              <div><Link href={`/app/crm/clients/${c.id}`}><strong>{c.ref}</strong> {c.name}</Link>
                <div className="small muted">{humanize(c.kind)}{c.city ? ` · ${c.city}` : ""} · owner {d.owners[c.ownerId] ?? "unknown"} · {c._count.leads} lead{c._count.leads === 1 ? "" : "s"}</div></div>
              <div className="row">{c.confidential ? <Pill status="WARN" label="Confidential" /> : null}{c.archivedAt ? <Pill status="ARCHIVED" label="Archived" /> : null}</div>
            </div></li>))} />
        )}
      </section>
      {can(member.role, "crm.manage") ? (
        <section className="card">
          <details className="inline"><summary>New client</summary>
            <form action={createClientAction} className="stack">
              <div className="fields">
                <Field label="Type"><select name="kind" defaultValue="INDIVIDUAL"><EnumOptions values={CLIENT_KINDS} /></select></Field>
                <Field label="Name"><input name="name" required /></Field>
                <Field label="Email"><input name="email" type="email" /></Field>
                <Field label="Phone"><input name="phone" inputMode="tel" /></Field>
                <Field label="City"><input name="city" /></Field>
                <Field label="Address"><input name="address" /></Field>
                {can(member.role, "crm.assign") ? <Field label="Owner" hint="Leave on yourself unless you are handing the client to someone."><select name="ownerId" defaultValue=""><option value="">Me</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field> : null}
              </div>
              <Field label="Notes"><textarea name="notes" rows={2} /></Field>
              <label className="row"><input type="checkbox" name="confidential" /> Confidential: only I and managers can see this client</label>
              <label className="row"><input type="checkbox" name="marketingConsent" /> The client agreed to receive marketing messages</label>
              <label className="row"><input type="checkbox" name="notDuplicate" /> This is a different client from any that look similar</label>
              <button className="btn primary" type="submit">Create client</button>
            </form>
          </details>
        </section>
      ) : null}
    </div>
  );
}
