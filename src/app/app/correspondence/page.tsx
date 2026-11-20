import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { CORR_SORTS, correspondenceSummary, listCorrespondence } from "@/lib/services/correspondence";
import { readSort } from "@/lib/list-sort";
import { ListTools, SortTh } from "@/components/ListTools";
import { isOverdue, STATUS_LABELS, type CorrStatus } from "@/lib/correspondence-rules";
import { formatDate, todayInLagos } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { Flash, Pill, TableMore, sp, type SP } from "@/components/ui";
import { companyInboundAddress } from "@/lib/services/inbound-email";
import { CopyButton } from "@/components/CopyButton";
import { newInboundAddressAction } from "./inbound-actions";

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
  const sort = readSort(searchParams, CORR_SORTS);
  const path = "/app/correspondence";
  const th = (k: string, label: string, dir: "asc" | "desc" = "asc") => <SortTh path={path} params={searchParams} sort={sort} k={k} dir={dir}>{label}</SortTh>;
  const [items, summary] = await Promise.all([
    listCorrespondence(member, { q, direction, view: view || undefined, sort }),
    correspondenceSummary(member),
  ]);
  const today = todayInLagos();
  const inbound = can(member.role, "correspondence.register") ? await companyInboundAddress(member).catch(() => null) : null;

  return (
    <div className="stack">
      <div className="row between">
        <h1>Correspondence</h1>
        {can(member.role, "correspondence.register") ? <Link className="btn primary" href="/app/correspondence/new">Register correspondence</Link> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {inbound ? (
        <details className="card inline">
          <summary>Receive letters by email</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <p className="small">Emails sent or forwarded to this address are registered here as incoming letters, with their attachments, and linked to the client whose email address sent them.</p>
            <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}><code className="break">{inbound}</code><CopyButton text={inbound} label="Copy address" done="Address copied" /></div>
            <p className="small muted">Share it only with people who should be able to send letters to your register. If it is passed around, make a new one: the old one stops working.</p>
            {can(member.role, "settings.manage") ? <form action={newInboundAddressAction}><button className="btn small" type="submit" data-confirm="Make a new address?" data-confirm-body="Emails to the old address will no longer arrive. Tell the people who use it." data-confirm-ok="Make new address">Make a new address</button></form> : null}
          </div>
        </details>
      ) : null}

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

      <ListTools path={path} params={searchParams} q={q} label="Search correspondence" placeholder="Reference, subject, sender, email text or attachment" options={CORR_SORTS} sort={sort} keep={["view"]}>
        <select name="direction" defaultValue={direction} aria-label="Direction">
          <option value="">Incoming and outgoing</option>
          <option value="INCOMING">Incoming</option>
          <option value="OUTGOING">Outgoing</option>
        </select>
      </ListTools>

      <div className="card table-wrap" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>{q || view || direction ? "Nothing matches. Try fewer words, or another view." : "No correspondence registered yet."}</p>
        ) : (
          <TableMore limit={12} noun="more rows" head={<tr>{th("ref", "Reference", "desc")}{th("subject", "Subject")}{th("party", "From / to")}<th>Assigned</th>{th("deadline", "Deadline")}{th("status", "Status")}</tr>} rows={items.map((c) => {
                const overdue = isOverdue(c.status as CorrStatus, c.responseDeadline, today);
                return (
                  <tr key={c.id}>
                    <td className="mono"><Link href={`/app/correspondence/${c.id}`}>{c.ref}</Link></td>
                    <td>
                      {c.subject}
                      <div className="small muted">
                        {c.direction === "INCOMING" ? "Incoming" : "Outgoing"}{c.dateReceived ? ` ${formatDate(c.dateReceived)}` : ""} · {c.category}
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
