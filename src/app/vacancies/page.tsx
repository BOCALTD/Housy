import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myVacancies } from "@/lib/services/vacancies";
import { activePolicies } from "@/lib/services/rewards";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Flash, Pill, sp, type SP } from "@/components/ui";

export const metadata = { title: "Report a vacancy" };
export const dynamic = "force-dynamic";

export default async function VacanciesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const page = Math.max(1, Number(sp(searchParams, "page") ?? 1) || 1);
  const [v, policies] = await Promise.all([myVacancies(user.id, page), activePolicies(user.id, "VACANCY")]);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Report a vacancy</h1><p className="muted">Seen an empty property that looks available? Tell us. We check it, and if it checks out you may earn a reward. <Link href="/rewards">My rewards</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack"><h2>How it works</h2>
        <ul className="small">
          <li>A report is what you saw. It is never published, and a verified report is not a listing.</li>
          <li>We check the place, whether it is really vacant, and who may advertise it. Only the owner or an authorised agent can allow a listing.</li>
          <li>Your name is never shown publicly. You choose whether we may contact you outside this app and whether the owner may be told your name.</li>
          <li>If the same place is reported twice, the earliest report is the one that counts, unless an administrator decides otherwise and says why.</li>
        </ul>
        {policies.length ? <details className="inline"><summary>What can be earned</summary><ul className="small">{policies.map((p) => <li key={p.id}>{p.name}: {formatKobo(p.amountKobo)}, paid {p.holdDays} days after approval if everything still stands.{p.terms ? ` ${p.terms}` : ""}</li>)}</ul></details> : <p className="small muted">No reward amount has been set yet.</p>}
        <div className="row"><Link className="btn primary" href="/vacancies/new">Report a vacancy</Link></div>
      </section>
      <section className="card"><h2>Your reports</h2>
        {v.items.length === 0 ? <p className="muted">You have not reported anything yet.</p> : (
          <ul className="timeline">{v.items.map((r) => (
            <li key={r.id}><div className="row between"><Link href={`/vacancies/${r.id}`}><strong>{humanize(r.propertyType)} in {r.area}, {r.city}</strong></Link><Pill status={r.outcome} /></div>
              <div className="small muted">{r.ref} · {formatDate(r.createdAt)} · {humanize(r.stage)}</div>
              <div className="small">{r.status}</div></li>))}</ul>
        )}
        <div className="row">{page > 1 ? <Link className="btn" href={`/vacancies?page=${page - 1}`}>Previous</Link> : null}{v.more ? <Link className="btn" href={`/vacancies?page=${page + 1}`}>Next</Link> : null}</div>
      </section>
    </div>
  );
}
