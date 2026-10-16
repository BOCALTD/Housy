import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { mySubscription } from "@/lib/services/subscriptions";
import { ENTITLEMENT_LABELS } from "@/lib/subscription-rules";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Pill } from "@/components/ui";

export const metadata = { title: "My plan" };
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const user = await requireUser();
  const p = await mySubscription(user.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>My plan</h1><p className="muted">A plan switches features on. It never gives anyone access to another person's or company's records.</p></div>
      <section className="card stack">
        {p.sub ? (
          <>
            <div className="row between"><h2>{p.sub.plan.name}</h2><Pill status={p.state === "ACTIVE" || p.state === "TRIAL" ? "ACTIVE" : p.state === "GRACE" || p.state === "READ_ONLY" ? "PENDING" : "SUSPENDED"} label={humanize(p.state)} /></div>
            <p>{p.explanation}</p>
            <p className="small muted">Runs until {formatDate(p.sub.periodEnd)}.{p.next ? ` On ${formatDate(p.next.on)} it becomes ${humanize(p.next.becomes).toLowerCase()}.` : ""}</p>
            <h3>What it includes</h3>
            {p.features.length === 0 ? <p className="muted">No paid features.</p> : <ul>{p.features.map((f) => <li key={f.key}>{ENTITLEMENT_LABELS[f.key]}{f.limit !== null ? ` (up to ${f.limit})` : ""}</li>)}</ul>}
            <details className="inline"><summary>Billing history</summary>
              <ul className="timeline">{p.sub.events.map((e) => <li key={e.id}><div><strong>{humanize(e.kind)}</strong> <span className="small muted">until {formatDate(e.periodEnd)} · {formatDate(e.createdAt)}{e.note ? ` · ${e.note}` : ""}</span></div></li>)}</ul>
            </details>
          </>
        ) : (
          <>
            <h2>Free</h2>
            <p>{p.explanation} Following agents and companies and browsing property are free. Collaborating with an agent needs a paid plan.</p>
            <p className="small"><Link href="/me/billing">See the plans you can buy</Link></p>
          </>
        )}
      </section>
    </div>
  );
}
