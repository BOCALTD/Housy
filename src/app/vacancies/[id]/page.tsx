import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMyVacancy } from "@/lib/services/vacancies";
import { VACANCY_STAGES, STAGE_TEXT } from "@/lib/vacancy-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { appealAction, privacyAction, replyAction, withdrawAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vacancy report" };

export default async function VacancyDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const user = await requireUser();
  const r = await getMyVacancy(user.id, params.id);
  if (!r) notFound();
  const at = VACANCY_STAGES.indexOf(r.stage);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>{humanize(r.propertyType)} in {r.area}</h1><p className="muted">{r.ref} · reported {formatDate(r.createdAt)} · <Link href="/vacancies">All my reports</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack"><div className="row between"><h2>Where it stands</h2><Pill status={r.outcome} /></div>
        <p>{r.status}</p>
        <ol className="small">{VACANCY_STAGES.map((s, i) => <li key={s} style={{ opacity: i <= at ? 1 : 0.55 }}>{i < at || (i === at && r.outcome === "APPROVED") ? "✓ " : i === at ? "→ " : ""}{STAGE_TEXT[s].label}</li>)}</ol>
        {r.outcome === "NEEDS_INFO" ? (
          <form action={replyAction} className="stack"><input type="hidden" name="id" value={r.id} /><Field label="Your answer"><textarea name="reply" required minLength={3} maxLength={1000} rows={3} /></Field><button className="btn primary" type="submit">Send answer</button></form>
        ) : null}
        {["OPEN", "NEEDS_INFO"].includes(r.outcome) ? <form action={withdrawAction}><input type="hidden" name="id" value={r.id} /><button className="btn" type="submit">Withdraw this report</button></form> : null}
        {["REJECTED", "MERGED"].includes(r.outcome) && !r.appealedAt ? (
          <details className="inline"><summary>Appeal this decision</summary><form action={appealAction} className="stack"><input type="hidden" name="id" value={r.id} /><Field label="Why do you disagree?"><textarea name="reason" required minLength={10} maxLength={1000} rows={3} /></Field><button className="btn" type="submit">Send appeal</button></form></details>
        ) : null}
        {r.dispute ? <p className="small muted">Appeal: {humanize(r.dispute.status)}{r.dispute.resolution ? `. ${r.dispute.resolution}` : ""}</p> : null}
      </section>
      <section className="card"><h2>Rewards</h2>
        {r.rewards.length === 0 ? <p className="muted">No reward yet. A reward opens when your report is verified.</p> : <ul className="timeline">{r.rewards.map((w) => <li key={w.id}><div className="row between"><span>{humanize(w.event)} · {formatKobo(w.amountKobo)}</span><Pill status={w.status} /></div><div className="small muted">{w.ref}{w.reason ? ` · ${w.reason}` : ""}</div></li>)}</ul>}
        <p className="small"><Link href="/rewards">See every reward and its history</Link></p>
      </section>
      <section className="card"><h2>Your privacy choices</h2>
        <form action={privacyAction} className="stack"><input type="hidden" name="id" value={r.id} />
          <label className="check"><input type="checkbox" name="allowContact" defaultChecked={r.allowContact} /><span>The review team may contact me outside this app.</span></label>
          <label className="check"><input type="checkbox" name="showNameToOwner" defaultChecked={r.showNameToOwner} /><span>The owner may be told my name.</span></label>
          <p className="small muted">Right now an owner would be told: “{r.ownerSees}”. The public is never told who reported a property.</p>
          <button className="btn" type="submit">Save choices</button></form>
      </section>
      <section className="card"><h2>What you reported</h2>
        <p className="small">{r.address}, {r.area}, {r.city}, {r.state}. Seen on {formatDate(r.observedOn)}.</p>
        <p>{r.description}</p>
        {r.files.length ? <ul className="small">{r.files.map((f) => <li key={f.id}><Link href={`/vacancies/file/${f.id}`}>{f.name}</Link></li>)}</ul> : null}
      </section>
      <section className="card"><h2>History</h2>
        <ShowMore noun="earlier entries" limit={4} items={r.events.slice().reverse().map((e) => <li key={e.id}><div className="small muted">{formatDateTime(e.createdAt)} · {e.actorName}</div><div>{e.note || (e.stage ? STAGE_TEXT[e.stage].label : humanize(e.outcome ?? ""))}</div></li>)} />
      </section>
    </div>
  );
}
