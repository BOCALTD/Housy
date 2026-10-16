import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { readinessChecks, readinessSummary, type Level } from "@/lib/readiness";
import { healthDetail } from "@/lib/services/health";
import { mfaStatus } from "@/lib/services/account";
import { Pill, TableMore } from "@/components/ui";

export const metadata = { title: "Launch readiness" };
export const dynamic = "force-dynamic";

const ORDER: Record<Level, number> = { fail: 0, warn: 1, ok: 2 };
const PILL: Record<Level, { status: string; label: string }> = { fail: { status: "REJECTED", label: "Fix before launch" }, warn: { status: "PENDING", label: "Check" }, ok: { status: "ACTIVE", label: "Ready" } };

export default async function LaunchPage() {
  const admin = await requirePlatformAdmin();
  const [detail, mfa] = await Promise.all([healthDetail(), mfaStatus(admin.id)]);
  const checks = readinessChecks(process.env).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const sum = readinessSummary(checks);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 4 }}>
        <p className="small"><Link href="/admin">Platform administration</Link></p>
        <h1>Launch readiness and operations</h1>
        <p className="small muted">This shows which settings exist, never their values. "Ready" means configured, not proven: send a real test email and a small real payment before launch.</p>
      </div>

      <section className="card stack">
        <h2>Settings {sum.ready ? <Pill status="ACTIVE" label="No blockers" /> : <Pill status="REJECTED" label={`${sum.fail} to fix`} />}</h2>
        <p className="small muted">{sum.ok} ready, {sum.warn} to check, {sum.fail} to fix.</p>
        <TableMore
          limit={6} noun="more settings"
          head={<tr><th>Setting</th><th>Status</th><th>What to do</th><th>Whose</th></tr>}
          rows={checks.map((c) => <tr key={c.id}><td>{c.label}</td><td><Pill status={PILL[c.level].status} label={PILL[c.level].label} /></td><td className="small">{c.detail}</td><td className="small">{c.owner === "you" ? "You" : c.owner === "hosting" ? "Hosting" : "Provider"}</td></tr>)}
        />
        <p className="small muted">Your own account: two-step sign-in is {mfa.enabled ? "on" : <>off. <Link href="/me/security">Turn it on</Link></>}.</p>
      </section>

      <section className="card stack">
        <h2>Right now {detail.ok ? <Pill status="ACTIVE" label="Database reachable" /> : <Pill status="REJECTED" label="Database not reachable" />}</h2>
        <div className="stats">
          <div className="stat"><b>{detail.email.queued}</b><span>Email waiting</span></div>
          <div className="stat"><b>{detail.email.failed}</b><span>Email retrying</span></div>
          <div className="stat"><b>{detail.email.dead}</b><span>Email gave up</span></div>
          <div className="stat"><b>{detail.payments.needingReview}</b><span>Payments need a decision</span></div>
          <div className="stat"><b>{detail.payments.pendingOverTwoDays}</b><span>Payments waiting over 2 days</span></div>
        </div>
        {detail.warnings.length === 0 ? <p className="muted">Nothing needs attention.</p> : <ul>{detail.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <p className="small">Go to: <Link href="/admin/notifications">Notifications and email</Link> · <Link href="/admin/payments">Payments</Link> · <Link href="/admin/finance?check=1">Run the books check</Link> · <Link href="/admin/ai">Assistant</Link></p>
        <p className="small muted">Not shown here: slow database queries and server errors. Read them on the server (journalctl -u housy, the PostgreSQL log); see the runbook.</p>
      </section>
    </div>
  );
}
