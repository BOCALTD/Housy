import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listValuations, BASES, PREMISES, PURPOSES } from "@/lib/services/valuation";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createInstructionAction } from "./actions";

export const metadata = { title: "Valuations" };

export default async function ValuationsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("valuation.view");
  const d = await listValuations(member);
  const manage = can(member.role, "valuation.manage");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Valuations</h1>
        <p className="muted">Record the instruction, build the worksheet from evidence, then have a second person approve the report. The system does the arithmetic. The opinion of value is the professional&apos;s.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="Valuation summary">
        <div className="stat"><b>{d.rows.filter((r) => ["INSTRUCTED", "IN_PROGRESS"].includes(r.status)).length}</b><span>Open</span></div>
        <div className="stat"><b>{d.waiting.length}</b><span>Waiting for approval</span></div>
        <div className="stat"><b>{d.overdue.length}</b><span>Overdue</span></div>
        <div className="stat"><b>{d.rows.filter((r) => ["APPROVED", "ISSUED"].includes(r.status)).length}</b><span>Approved or issued</span></div>
      </section>

      <section className="card">
        <h2>All valuations</h2>
        {d.rows.length === 0 ? <p className="muted">No valuations yet.</p> : (
          <ShowMore noun="more valuations" limit={8} items={
            d.rows.map((r) => {
              const rep = r.reports[0];
              const late = ["INSTRUCTED", "IN_PROGRESS"].includes(r.status) && r.dueDate && r.dueDate.getTime() < Date.now() - 86_400_000;
              return (
                <li key={r.id}><div className="row between" style={{ width: "100%" }}>
                  <div>
                    <Link href={`/app/valuations/${r.id}`}><strong>{r.ref}</strong></Link> · {r.asset.ref} {r.asset.name}
                    <div className="small muted">{r.clientName} · {humanize(r.purpose)} · {humanize(r.basis)}{r.premise !== "STANDARD" ? ` · ${humanize(r.premise)}` : ""}</div>
                    <div className="small muted">
                      {r.valuationDate ? `As at ${formatDate(r.valuationDate)}` : "Valuation date not set"}{r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ""}
                      {rep?.status === "APPROVED" && rep.concludedValueKobo ? ` · ${formatKobo(rep.concludedValueKobo)}` : ""}
                    </div>
                  </div>
                  <div className="row">{late ? <Pill status="OVERDUE" label="Overdue" /> : null}<Pill status={r.status} label={humanize(r.status)} /></div>
                </div></li>
              );
            })} />
        )}
      </section>

      {manage ? (
        <section className="card" aria-labelledby="new-h">
          <details className="inline">
          <summary id="new-h">New instruction</summary>
          <form action={createInstructionAction} className="stack">
            <div className="fields">
              <Field label="Asset"><select name="assetId" required defaultValue=""><option value="" disabled>Choose an asset</option>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
              <Field label="Client"><input name="clientName" required /></Field>
              <Field label="Client reference"><input name="clientReference" /></Field>
              <Field label="Purpose"><select name="purpose" defaultValue="SALE"><EnumOptions values={PURPOSES} /></select></Field>
              <Field label="Basis of value"><select name="basis" defaultValue="MARKET_VALUE"><EnumOptions values={BASES} /></select></Field>
              <Field label="Premise" hint="Going concern values the asset with its business continuing. Gone concern assumes it will not."><select name="premise" defaultValue="STANDARD"><EnumOptions values={PREMISES} /></select></Field>
              <Field label="Valuation date" hint="The date the value is stated as at."><input name="valuationDate" type="date" /></Field>
              <Field label="Due date"><input name="dueDate" type="date" /></Field>
              <Field label="Assigned to"><select name="assignedToId" defaultValue=""><option value="">Not yet assigned</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            </div>
            <Field label="Purpose notes"><input name="purposeNote" /></Field>
            <Field label="Asset description"><textarea name="assetDescription" rows={3} /></Field>
            <Field label="Scope of work"><textarea name="scope" rows={2} /></Field>
            <div className="fields">
              <Field label="Valuing professional" hint="Enter their details exactly as registered."><input name="professionalName" /></Field>
              <Field label="Professional body"><input name="professionalBody" /></Field>
              <Field label="Registration number"><input name="registrationNo" /></Field>
            </div>
            <button className="btn primary" type="submit">Create instruction</button>
          </form>
          </details>
        </section>
      ) : null}
    </div>
  );
}
