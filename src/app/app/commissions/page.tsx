import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { COMMISSION_APPLIES, COMMISSION_METHODS, commissionQueue, listCommissionRules } from "@/lib/services/commission";
import { bpsToPercent } from "@/lib/commission-rules";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { addRuleAction, ruleActiveAction } from "./actions";

export const metadata = { title: "Commissions" };

export default async function CommissionsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("crm.view");
  const [q, rules] = await Promise.all([commissionQueue(member), listCommissionRules(member)]);
  const configure = can(member.role, "crm.configure");
  const waiting = q.rows.filter((r) => r.status === "SUBMITTED");
  const due = q.rows.filter((r) => r.status === "APPROVED");
  const row = (r: (typeof q.rows)[number]) => (
    <li key={r.id}><div className="row between" style={{ width: "100%" }}>
      <div><Link href={`/app/deals/${r.deal.id}/file`}><strong>{r.deal.ref}</strong> {r.deal.title}</Link>
        <div className="small muted">{formatKobo(r.totalKobo)} · {r.ruleName} · proposed {formatDate(r.submittedAt)} · {r.splits.length} {r.splits.length === 1 ? "person" : "people"}</div></div>
      <div className="row"><Pill status={r.status} label={humanize(r.status)} />{r.deal.status === "DISPUTED" ? <Pill status="DISPUTED" label="Withheld" /> : null}</div>
    </div></li>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Commissions</h1><p className="muted">{q.manager ? "Commissions on completed deals: waiting for approval, approved and waiting for payment, and paid." : "Commissions you share in."} <Link href="/app/sales">Sales dashboard</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{waiting.length}</b><span>Waiting for approval</span></div>
        <div className="stat"><b>{due.length}</b><span>Approved, not fully paid</span></div>
        <div className="stat"><b>{q.rows.filter((r) => r.status === "PAID").length}</b><span>Paid</span></div>
      </section>
      <section className="card"><h2>Waiting for approval</h2>{waiting.length === 0 ? <p className="muted">Nothing waiting.</p> : <ShowMore noun="more" limit={5} items={waiting.map(row)} />}</section>
      <section className="card"><h2>Approved, waiting for payment</h2>{due.length === 0 ? <p className="muted">Nothing to pay.</p> : <ShowMore noun="more" limit={5} items={due.map(row)} />}</section>
      <section className="card"><h2>Paid</h2>{q.rows.filter((r) => r.status === "PAID").length === 0 ? <p className="muted">Nothing paid yet.</p> : <ShowMore noun="more" limit={5} items={q.rows.filter((r) => r.status === "PAID").map(row)} />}</section>
      <section className="card">
        <h2>Commission rules</h2>
        <p className="small muted">You set the rates. A rule is never edited: stop using it and add a new one. A commission copies the rule when it is proposed.</p>
        {rules.length === 0 ? <p className="muted">No rules yet.</p> : (
          <ShowMore noun="more rules" limit={5} items={rules.map((r) => (
            <li key={r.id}><div className="row between" style={{ width: "100%" }}>
              <div><strong>{r.name}</strong>{r.active ? "" : " (not in use)"}<div className="small muted">{humanize(r.applies)} · {r.method === "PERCENT" ? `${bpsToPercent(r.rateBps ?? 0)}% of the agreed price` : `${formatKobo(r.fixedKobo ?? 0n)} fixed`}</div></div>
              {configure ? <form action={ruleActiveAction}><input type="hidden" name="ruleId" value={r.id} /><input type="hidden" name="active" value={r.active ? "no" : "yes"} /><button className="btn" type="submit">{r.active ? "Stop using" : "Use again"}</button></form> : null}
            </div></li>))} />
        )}
        {configure ? (
          <details className="inline"><summary>Add a rule</summary>
            <form action={addRuleAction} className="stack">
              <div className="fields">
                <Field label="Name"><input name="name" required /></Field>
                <Field label="Applies to"><select name="applies" defaultValue="ALL"><EnumOptions values={COMMISSION_APPLIES} /></select></Field>
                <Field label="Method"><select name="method" defaultValue="PERCENT"><EnumOptions values={COMMISSION_METHODS} /></select></Field>
                <Field label="Percentage" hint="For the percent method, for example 5 or 2.5."><input name="rate" inputMode="decimal" /></Field>
                <Field label="Fixed amount (₦)" hint="For the fixed method."><input name="fixed" inputMode="decimal" /></Field>
              </div>
              <button className="btn primary" type="submit">Add rule</button></form>
          </details>
        ) : null}
      </section>
    </div>
  );
}
