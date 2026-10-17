import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { correspondenceSummary, listCorrespondence } from "@/lib/services/correspondence";
import { isOverdue, STATUS_LABELS, type CorrStatus } from "@/lib/correspondence-rules";
import { formatDate, todayInLagos } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { Flash, Pill, TableMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Correspondence" };

const VIEWS = [
  { key: "", label: "All" },
  { key: "mine", label: "Assigned to me" },
  { key: "unassigned", label: "Unassigned" },
  { key: "overdue", label: "Overdue" },
  { key: "approval", label: "Awaiting approval" },
] as const;

export default async function CorrespondencePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("correspondence.view");
  const view = (sp(searchParams, "view") ?? "") as "" | "mine" | "unassigned" | "overdue" | "approval";
  const q = sp(searchParams, "q") ?? "";
  const direction = sp(searchParams, "direction") ?? "";
  const [items, summary] = await Promise.all([
    listCorrespondence(member, { q, direction, view: view || undefined }),
    correspondenceSummary(member),
  ]);
  const today = todayInLagos();

  return (
    <div className="stack">
      <div className="row between">
        <h1>Correspondence</h1>
        {can(member.role, "correspondence.register") ? <Link className="btn primary" href="/app/correspondence/new">Register correspondence</Link> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="Correspondence summary">
        <Link href="/app/correspondence?view=mine" className="stat" style={{ textDecoration: "none" }}><b>{summary.mine}</b><span>Assigned to me</span></Link>
        <Link href="/app/correspondence?view=unassigned" className="stat" style={{ textDecoration: "none" }}><b>{summary.unassigned}</b><span>Unassigned</span></Link>
        <Link href="/app/correspondence?view=overdue" className={`stat${summary.overdue ? " alert" : ""}`} style={{ textDecoration: "none" }}><b>{summary.overdue}</b><span>Overdue replies</span></Link>
        <div className="stat"><b>{summary.dueSoon}</b><span>Due in the next 7 days</span></div>
        <Link href="/app/correspondence?view=approval" className="stat" style={{ textDecoration: "none" }}><b>{summary.awaitingApproval}</b><span>Awaiting approval</span></Link>
      </section>

      <nav className="nav" aria-label="Correspondence views">
        {VIEWS.map((v) => (
          <Link key={v.key} href={v.key ? `/app/correspondence?view=${v.key}` : "/app/correspondence"} aria-current={view === v.key ? "page" : undefined}>{v.label}</Link>
        ))}
      </nav>

      <form className="row" role="search">
        {view ? <input type="hidden" name="view" value={view} /> : null}
        <input name="q" id="q" defaultValue={q} placeholder="Reference, subject, sender or recipient" aria-label="Search correspondence"
               style={{ flex: "1 1 240px", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: "var(--surface)" }} />
        <select name="direction" id="direction" defaultValue={direction} aria-label="Direction"
                style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: "var(--surface)" }}>
          <option value="">Incoming and outgoing</option>
          <option value="INCOMING">Incoming</option>
          <option value="OUTGOING">Outgoing</option>
        </select>
        <button className="btn" type="submit">Search</button>
      </form>

      <div className="card table-wrap" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>{q || view || direction ? "Nothing matches this view." : "No correspondence registered yet."}</p>
        ) : (
          <TableMore limit={12} noun="more rows" head={<tr><th>Reference</th><th>Subject</th><th>From / to</th><th>Assigned</th><th>Deadline</th><th>Status</th></tr>} rows={items.map((c) => {
                const overdue = isOverdue(c.status as CorrStatus, c.responseDeadline, today);
                return (
                  <tr key={c.id}>
                    <td className="mono"><Link href={`/app/correspondence/${c.id}`}>{c.ref}</Link></td>
                    <td>
                      {c.subject}
                      <div className="small muted">
                        {c.direction === "INCOMING" ? "Incoming" : "Outgoing"} · {c.category}
                        {c.confidential ? " · Confidential" : ""}{c.priority === "URGENT" || c.priority === "HIGH" ? ` · ${c.priority.toLowerCase()} priority` : ""}
                      </div>
                    </td>
                    <td className="small">{c.direction === "INCOMING" ? c.senderName : c.recipientName}</td>
                    <td className="small">{c.assignee ? c.assignee.user.name : <span className="muted">Unassigned</span>}</td>
                    <td className="small">{formatDate(c.responseDeadline)}{overdue ? <> <Pill status="OVERDUE" /></> : null}</td>
                    <td><Pill status={c.status} label={STATUS_LABELS[c.status as CorrStatus]} /></td>
                  </tr>
                );
              })} />
        )}
      </div>
    </div>
  );
}
