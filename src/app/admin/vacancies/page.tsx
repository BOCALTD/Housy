import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { openVacancyAppeals, vacancyAnalytics, vacancyQueue } from "@/lib/services/vacancies";
import { STAGE_TEXT, VACANCY_STAGES } from "@/lib/vacancy-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { appealDecisionAction } from "./actions";

export const metadata = { title: "Vacancy reports" };
export const dynamic = "force-dynamic";

export default async function AdminVacanciesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const outcome = sp(searchParams, "outcome") ?? "OPEN";
  const stage = sp(searchParams, "stage") ?? "";
  const flagged = sp(searchParams, "flagged") === "1";
  const q = sp(searchParams, "q") ?? "";
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const [list, appeals, a] = await Promise.all([vacancyQueue(admin.id, { outcome: outcome === "ALL" ? undefined : outcome, stage: stage || undefined, flagged, q }, page), openVacancyAppeals(admin.id), vacancyAnalytics(admin.id)]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ outcome, ...(stage ? { stage } : {}), ...(flagged ? { flagged: "1" } : {}), ...(q ? { q } : {}), ...extra }).toString();
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Vacancy reports</h1><p className="muted">Verifying a report pays the reporter. It never publishes a property. <Link href="/admin/rewards">Rewards</Link> · <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{list.byOutcome.OPEN ?? 0}</b><span>Open</span></div>
        <div className="stat"><b>{list.byOutcome.NEEDS_INFO ?? 0}</b><span>Waiting for reporters</span></div>
        <div className="stat"><b>{list.flagged}</b><span>With warning signs</span></div>
        <div className="stat"><b>{appeals.length}</b><span>Appeals</span></div>
      </section>
      <section className="card"><h2>Queue</h2>
        <form method="get" className="row"><input name="q" defaultValue={q} placeholder="Reference, neighbourhood or city" aria-label="Search" /><select name="outcome" defaultValue={outcome} aria-label="Outcome">{["OPEN", "NEEDS_INFO", "APPROVED", "REJECTED", "MERGED", "WITHDRAWN", "ALL"].map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select><select name="stage" defaultValue={stage} aria-label="Stage"><option value="">Any stage</option>{VACANCY_STAGES.map((s) => <option key={s} value={s}>{STAGE_TEXT[s].label}{list.byStage[s] ? ` (${list.byStage[s]})` : ""}</option>)}</select><label className="check"><input type="checkbox" name="flagged" value="1" defaultChecked={flagged} /><span>Warning signs only</span></label><button className="btn" type="submit">Filter</button></form>
        {list.items.length === 0 ? <p className="muted">Nothing matches.</p> : (
          <ul className="timeline">{list.items.map((r) => (
            <li key={r.id}><div className="row between"><Link href={`/admin/vacancies/${r.id}`}><strong>{r.ref}</strong> · {humanize(r.propertyType)} in {r.area}, {r.city}</Link><Pill status={r.outcome} /></div>
              <div className="small muted">{formatDate(r.createdAt)} · {STAGE_TEXT[r.stage].label}{r.flagged ? " · warning signs" : ""}{r.duplicateOfId ? " · possible duplicate" : ""}</div></li>))}</ul>
        )}
        <div className="row">{page > 1 ? <Link className="btn" href={`/admin/vacancies?${qs({ page: String(page - 1) })}`}>Previous</Link> : null}{list.more ? <Link className="btn" href={`/admin/vacancies?${qs({ page: String(page + 1) })}`}>Next</Link> : null}</div>
      </section>
      <section className="card"><h2>Appeals</h2>
        {appeals.length === 0 ? <p className="muted">No open appeals.</p> : (
          <ShowMore noun="more appeals" limit={3} items={appeals.map((d) => (
            <li key={d.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="small muted">{formatDate(d.createdAt)} · {d.report ? <Link href={`/admin/vacancies/${d.report.id}`}>{d.report.ref}</Link> : "report"} · {d.report ? humanize(d.report.outcome) : ""}{d.report?.rejectReason ? ` · ${d.report.rejectReason}` : ""}</div>
              <div>{d.reason}</div>
              <details className="inline"><summary>Decide</summary><form action={appealDecisionAction} className="stack"><input type="hidden" name="disputeId" value={d.id} /><Field label="Decision and reasons"><input name="resolution" required minLength={5} maxLength={1000} /></Field><div className="row"><button className="btn primary" type="submit" name="decision" value="uphold">Uphold and reopen</button><button className="btn" type="submit" name="decision" value="deny">Deny</button></div></form></details>
            </div></li>))} />
        )}
      </section>
      <section className="card"><h2>Where vacancies are being seen</h2>
        <p className="small muted">Areas with fewer than 3 reports are not broken out, so no figure points at one person.</p>
        <div className="stats"><div className="stat"><b>{a.total}</b><span>Reports</span></div><div className="stat"><b>{a.verifiedRate === null ? "—" : `${a.verifiedRate}%`}</b><span>Verified, of those decided</span></div><div className="stat"><b>{a.meanDaysToDecision ?? "—"}</b><span>Days to decide</span></div></div>
        {a.areas.length === 0 ? <p className="muted">No area has 3 or more reports yet.</p> : <ShowMore noun="more areas" limit={6} items={a.areas.map((x) => <li key={`${x.state}-${x.city}-${x.area}`}><span>{x.area}, {x.city}</span> <span className="small muted">{x.count}</span></li>)} />}
        {a.small ? <p className="small muted">{a.small} more reports are in areas with fewer than 3.</p> : null}
        <details className="inline"><summary>Reward spending on vacancies</summary>{a.rewards.length === 0 ? <p className="small muted">None yet.</p> : <ul className="timeline">{a.rewards.map((r) => <li key={r.status}><span className="small">{humanize(r.status)}: {r.count} · {formatKobo(r.kobo)}</span></li>)}</ul>}</details>
      </section>
    </div>
  );
}
