import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listInspections } from "@/lib/services/inspections";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createTemplateAction, installStartersAction, toggleTemplateAction } from "../actions";

export const metadata = { title: "Inspection templates" };

export default async function TemplatesPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const { templates } = await listInspections(member);
  const manage = can(member.role, "inspection.manage");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/inspections">All inspections</Link></p>
        <h1>Inspection templates</h1>
        <p className="muted">A template is a reusable checklist. Starting an inspection copies the checklist, so changing a template later never changes past inspections.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        {templates.length === 0 ? <p className="muted">No templates yet.</p> : (
          <ShowMore noun="more" limit={5} items={templates.map((t) => (
              <li key={t.id}>
                <div className="row between" style={{ width: "100%" }}>
                  <div>{t.name} <span className="small muted">{t.assetClass ? humanize(t.assetClass) : "Any asset class"} · {t._count.items} items</span></div>
                  <div className="row">
                    <Pill status={t.active ? "ACTIVE" : "CANCELLED"} label={t.active ? "In use" : "Switched off"} />
                    {manage ? (
                      <form action={toggleTemplateAction}><input type="hidden" name="templateId" value={t.id} /><input type="hidden" name="active" value={t.active ? "false" : "true"} /><button className="btn small" type="submit">{t.active ? "Switch off" : "Switch on"}</button></form>
                    ) : null}
                  </div>
                </div>
              </li>
            ))} />
        )}
        {manage ? <form action={installStartersAction} style={{ marginTop: 10 }}><button className="btn" type="submit">Add starter templates for each asset class</button></form> : null}
      </section>
      {manage ? (
        <section className="card">
          <h2>New template</h2>
          <form action={createTemplateAction} className="stack">
            <Field label="Name"><input name="name" required /></Field>
            <Field label="Asset class"><select name="assetClass" defaultValue=""><option value="">Any</option>{["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "PLANT_MACHINERY", "OTHER"].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
            <Field label="Checklist" hint="One item per line, as Category | What to check. For example: Roofing | Gutters clear and sound.">
              <textarea name="checklist" rows={8} required />
            </Field>
            <button className="btn primary" type="submit">Create template</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
