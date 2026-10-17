import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listServicePeriods, SERVICE_METHODS } from "@/lib/services/service-charges";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { createServicePeriodAction } from "./actions";

export const metadata = { title: "Service charges" };

export default async function ServiceChargesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("finance.view");
  const { rows, assets } = await listServicePeriods(member);
  const renderRow = (r: (typeof rows)[number]) => (
              <div key={r.period.id} className="row between">
                <div>
                  <Link href={`/app/service-charges/${r.period.id}`}><strong>{r.period.name}</strong></Link>
                  <div className="small muted">{r.asset.ref} · {r.asset.name} · {formatDate(r.period.startDate)} to {formatDate(r.period.endDate)} · {humanize(r.period.method)}</div>
                </div>
                <div className="row">
                  <span className="small">Budget {formatKobo(r.period.budgetKobo)} · collected {formatKobo(r.collected)} · fund {formatKobo(r.balance)}</span>
                  <Pill status={r.period.status === "OPEN" ? "OPEN" : "ACTIVE"} label={r.period.status === "OPEN" ? "Not yet shared" : "Shared"} />
                </div>
              </div>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Service charges</h1>
        <p className="muted">Each period has a budget, shared between the tenants. What is collected goes into a fund that is kept apart from rent.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {rows.length === 0 ? <p className="muted">No service charge periods yet.</p> : (
        <div className="card">
          <div className="stack">
            {rows.slice(0, 6).map(renderRow)}
            {rows.length > 6 ? (
              <details className="inline">
                <summary>Show {rows.length - 6} more periods</summary>
                <div className="stack">{rows.slice(6).map(renderRow)}</div>
              </details>
            ) : null}
          </div>
        </div>
      )}
      {can(member.role, "service.manage") ? (
        <section className="card" aria-labelledby="new-h">
          <h2 id="new-h">New service charge period</h2>
          {assets.length === 0 ? <p className="muted">Register an asset first.</p> : (
            <form action={createServicePeriodAction} className="stack">
              <Field label="Property">
                <select name="assetId" required>{assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select>
              </Field>
              <Field label="Name"><input name="name" required placeholder="For example: 2026 service charge" /></Field>
              <div className="fields">
                <Field label="Starts"><input name="startDate" type="date" required /></Field>
                <Field label="Ends"><input name="endDate" type="date" required /></Field>
              </div>
              <div className="fields">
                <Field label="Budget (₦)"><input name="budget" required inputMode="decimal" /></Field>
                <Field label="Shared by"><select name="method" defaultValue="EQUAL"><EnumOptions values={SERVICE_METHODS} /></select></Field>
              </div>
              <button className="btn primary" type="submit">Create period</button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
