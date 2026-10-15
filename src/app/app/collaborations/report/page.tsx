import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { asCompany, collaborationReport } from "@/lib/services/collab";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { ShowMore } from "@/components/ui";

export const metadata = { title: "Collaboration report" };
export const dynamic = "force-dynamic";

export default async function CollaborationReportPage() {
  const member = await requireMember("collab.company");
  const r = await collaborationReport(asCompany(member));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Collaboration report</h1><p className="muted">What your company is doing with others, and what it has shared. <Link href="/app/collaborations">Back</Link></p></div>
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{r.total}</b><span>Collaborations</span></div>
        <div className="stat"><b>{r.itemsShared}</b><span>Items you shared</span></div>
        <div className="stat"><b>{r.itemsRevoked}</b><span>Taken back</span></div>
        <div className="stat"><b>{r.planHeld}</b><span>Held by a plan</span></div>
      </section>
      <section className="card"><h2>By status</h2>
        {Object.keys(r.byStatus).length === 0 ? <p className="muted">Nothing yet.</p> : <ul className="timeline">{Object.entries(r.byStatus).map(([k, v]) => <li key={k}>{humanize(k)}: {v}</li>)}</ul>}</section>
      <section className="card"><h2>Recent activity across your collaborations</h2>
        {r.events.length === 0 ? <p className="muted">Nothing yet.</p> : <ShowMore noun="more" limit={8} items={r.events.map((e) => <li key={e.id}><div><span className="small muted">{formatDate(e.createdAt)} · {e.actorName} · {r.refs[e.collaborationId]?.ref}</span><div>{e.summary}</div></div></li>)} />}</section>
    </div>
  );
}
