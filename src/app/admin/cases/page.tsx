import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminCases } from "@/lib/services/trust-cases";
import { CASE_CATEGORIES, CASE_STATUS_LABEL, SEVERITIES, overdue, type CaseStatus } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";
import { Flash, Pill, TableMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Trust and Safety cases" };
export const dynamic = "force-dynamic";

export default async function CasesAdmin({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const admin = await requirePlatformAdmin();
  const status = sp(s, "status") ?? "open", severity = sp(s, "severity") ?? "", mine = sp(s, "mine") === "1";
  const rows = await adminCases(admin.id, { status, severity, mine });
  const link = (o: Record<string, string>) => `/admin/cases?${new URLSearchParams({ status, ...(severity ? { severity } : {}), ...(mine ? { mine: "1" } : {}), ...o }).toString()}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Trust and Safety cases</h1><p className="muted">Most serious first, then by deadline. Critical cases are due in 24 hours, high in 3 days, medium in 7, low in 14.</p></div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <nav className="sort-links" aria-label="Filter cases">
        <Link href={link({ status: "open" })} aria-current={status === "open" ? "page" : undefined}>Open</Link>
        <Link href={link({ status: "closed" })} aria-current={status === "closed" ? "page" : undefined}>Closed</Link>
        <Link href={link({ status: "all" })} aria-current={status === "all" ? "page" : undefined}>All</Link>
        {SEVERITIES.map((v) => <Link key={v} href={link({ severity: severity === v ? "" : v })} aria-current={severity === v ? "page" : undefined}>{v.toLowerCase()}</Link>)}
        <Link href={link({ mine: mine ? "" : "1" })} aria-current={mine ? "page" : undefined}>Assigned to me</Link>
      </nav>
      <section className="card">
        {rows.length === 0 ? <p className="muted">No cases here.</p> : (
          <TableMore limit={15} noun="more cases" head={<tr><th>Case</th><th>Severity</th><th>What</th><th>Status</th><th>Due</th></tr>} rows={rows.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/admin/cases/${c.ref}`}>{c.ref}</Link></td>
              <td><Pill status={c.severity === "CRITICAL" || c.severity === "HIGH" ? "SUSPENDED" : "PENDING"} label={c.severity.toLowerCase()} /></td>
              <td className="small">{CASE_CATEGORIES[c.category as keyof typeof CASE_CATEGORIES] ?? c.category}{c.targetRef ? ` · ${c.targetRef}` : ""}</td>
              <td className="small">{CASE_STATUS_LABEL[c.status as CaseStatus]}</td>
              <td className="small">{overdue({ status: c.status as CaseStatus, dueAt: c.dueAt }) ? <strong style={{ color: "var(--bad)" }}>Overdue · {formatDateTime(c.dueAt)}</strong> : formatDateTime(c.dueAt)}</td>
            </tr>
          ))} />
        )}
      </section>
    </div>
  );
}
