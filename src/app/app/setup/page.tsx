import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { TEMPLATES, templateFor } from "@/lib/industry-templates";
import { setupState } from "@/lib/services/industry-setup";
import { can } from "@/lib/permissions";
import { todayInLagos, toDateOnlyString } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";
import { applyTemplateAction } from "./actions";

export const metadata = { title: "Set up for your kind of business" };
export const dynamic = "force-dynamic";

/**
 * Choose the kind of business, see exactly what that adds, untick what you do not want, enter your own dates and rates, and apply.
 * Applying again only adds what is missing.
 */
export default async function SetupPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const s = await searchP;
  const member = await requireMember("settings.manage");
  const state = await setupState(member);
  const t = templateFor(sp(s, "t") ?? state.current);
  const today = toDateOnlyString(todayInLagos());
  const Had = ({ yes }: { yes: boolean }) => (yes ? <span className="pill">Already set up</span> : null);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Business set-up</p>
        <h1>Set up for your kind of business</h1>
        <p className="muted">Pick what you do and the workspace is prepared for it: departments, inspection checklists, reminders for levies and renewals, and commission rules. You see everything first, choose what to keep, and enter your own dates and rates. Nothing you already have is changed.</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <ul className="setup-kinds" aria-label="Kinds of business">
        {TEMPLATES.map((x) => (
          <li key={x.key}>
            <Link className={`setup-kind${t?.key === x.key ? " on" : ""}`} href={`/app/setup?t=${x.key}`} aria-current={t?.key === x.key ? "true" : undefined}>
              <strong>{x.name}</strong><span>{x.who}</span>
              {state.current === x.key ? <span className="pill brand">Your set-up</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {t ? (
        <form action={applyTemplateAction} className="stack-lg">
          <input type="hidden" name="template" value={t.key} />
          <div className="card stack"><h2>{t.name}</h2><p className="muted">{t.summary}</p></div>

          <section className="card stack" aria-labelledby="dep-h">
            <h3 id="dep-h">Departments</h3>
            <p className="small muted">Used in correspondence references and to group your team.</p>
            {t.departments.map((d) => <label key={d.code} className="check"><input type="checkbox" name="department" value={d.code} defaultChecked={!state.has.departments.has(d.code)} disabled={state.has.departments.has(d.code)} /> {d.name} <span className="small muted">({d.code})</span> <Had yes={state.has.departments.has(d.code)} /></label>)}
          </section>

          <section className="card stack" aria-labelledby="chk-h">
            <h3 id="chk-h">Inspection checklists</h3>
            {t.checklists.map((k) => (
              <div key={k.name} className="stack" style={{ gap: 4 }}>
                <label className="check"><input type="checkbox" name="checklist" value={k.name} defaultChecked={!state.has.checklists.has(k.name)} disabled={state.has.checklists.has(k.name)} /> <strong>{k.name}</strong> <span className="small muted">({k.items.length} checks)</span> <Had yes={state.has.checklists.has(k.name)} /></label>
                <details className="inline"><summary>See the checks</summary><ul className="small">{k.items.map((it) => <li key={it.prompt}><span className="muted">{it.category}:</span> {it.prompt}</li>)}</ul></details>
              </div>
            ))}
          </section>

          {t.obligations.length && can(member.role, "obligation.manage") ? (
            <section className="card stack" aria-labelledby="obl-h">
              <h3 id="obl-h">Reminders for levies, renewals and permits</h3>
              <p className="small muted">Tick the ones that apply and enter when each is next due. Amounts are left for you to enter when they are assessed; the platform does not know your rates.</p>
              {t.obligations.map((o) => (
                <div key={o.id} className="setup-row">
                  <label className="check"><input type="checkbox" name="obligation" value={o.id} disabled={state.has.obligations.has(o.title)} /> <strong>{o.title}</strong> <Had yes={state.has.obligations.has(o.title)} /></label>
                  <p className="small muted">{o.why} {o.months ? `Repeats every ${o.months === 12 ? "year" : `${o.months} months`}.` : "Once."}{o.review ? " Needs a professional's review before it can be marked done." : ""}</p>
                  {!state.has.obligations.has(o.title) ? <label className="field">Next due<input type="date" name={`due-${o.id}`} min={today} /></label> : null}
                </div>
              ))}
            </section>
          ) : null}

          {t.commission.length && can(member.role, "crm.configure") ? (
            <section className="card stack" aria-labelledby="com-h">
              <h3 id="com-h">Commission rules</h3>
              <p className="small muted">Your own percentages. The usual figure in the market is shown as a guide only.</p>
              {t.commission.map((r) => (
                <div key={r.id} className="setup-row">
                  <label className="check"><input type="checkbox" name="rule" value={r.id} disabled={state.has.rules.has(r.name)} /> <strong>{r.name}</strong> <span className="small muted">({r.applies === "ALL" ? "all deals" : r.applies.toLowerCase()})</span> <Had yes={state.has.rules.has(r.name)} /></label>
                  {!state.has.rules.has(r.name) ? <label className="field">Percentage<input name={`rate-${r.id}`} inputMode="decimal" placeholder={`Often ${r.usual}%`} /></label> : null}
                </div>
              ))}
            </section>
          ) : null}

          <section className="card stack" aria-labelledby="rem-h">
            <h3 id="rem-h">Reminder timings</h3>
            <label className="check"><input type="checkbox" name="reminders" value="yes" defaultChecked={state.current !== t.key} /> Show things as due {t.reminders.leadDays} days ahead and escalate to administrators {t.reminders.escalationDays} days after they are overdue <span className="small muted">(now {state.reminders.leadDays} and {state.reminders.escalationDays})</span></label>
          </section>

          <div className="row"><button className="btn primary" type="submit">Apply this set-up</button><Link className="btn" href="/app">Not now</Link></div>
        </form>
      ) : <p className="muted">Choose the kind of business above to see what it adds.</p>}
    </div>
  );
}
