import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { displayQueue, KIND_STATUS } from "@/lib/services/completed";
import { formatDate } from "@/lib/dates";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { reviewDisplayAction } from "./actions";

export const metadata = { title: "Completed deals to check" };
export const dynamic = "force-dynamic";

export default async function AdminCompletedPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const q = await displayQueue(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><p className="eyebrow">Platform Super Super Admin</p><h1>Completed deals to check</h1>
        <p className="muted">Approve only deals that are really completed and where the company says the people agreed. Nothing but the property type, area and month is shown. <Link href="/admin">Back to platform administration</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Waiting ({q.length})</h2>
        {q.length === 0 ? <p className="muted">Nothing is waiting.</p> : (
          <ShowMore noun="more" limit={4} items={q.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%" }}>
              <div><strong>{KIND_STATUS[r.kind]}</strong>: {r.bedrooms != null ? `${r.bedrooms}-bedroom ` : ""}{r.category}, {r.city}, {r.state} <span className="small muted">· {r.companyName} · deal {r.deal?.ref ?? "?"} · {r.deal?.status ?? "missing"}{r.deal?.completedAt ? ` ${formatDate(r.deal.completedAt)}` : ""}</span></div>
              <p className="small">Authorisation given: {r.authorisation}</p>
              <form action={reviewDisplayAction} className="row"><input type="hidden" name="id" value={r.id} /><Field label="Note (needed to turn down)"><input name="note" /></Field>
                <button className="btn primary" type="submit" name="decision" value="approve">Approve</button><button className="btn" type="submit" name="decision" value="reject">Turn down</button></form>
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
