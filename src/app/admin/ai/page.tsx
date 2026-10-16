import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { aiAuditForAdmin, aiStatus } from "@/lib/services/ai";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { AI_FEATURES, type AiFeature } from "@/lib/ai-rules";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { saveAiConfigAction } from "./actions";

export const metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default async function AdminAiPage({ searchParams }: { searchParams?: SP }) {
  const admin = await requirePlatformAdmin();
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [st, audit] = await Promise.all([aiStatus(admin.id), aiAuditForAdmin(admin.id, page)]);
  const c = st.config;
  const features = Object.keys(AI_FEATURES) as AiFeature[];
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Assistant</h1><p className="muted">Everything the assistant does works with the platform&apos;s own rules, so nothing stops if the AI service is off or fails. <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{st.connected ? "Connected" : "Not connected"}</b><span>AI service{st.provider ? ` (${st.provider})` : ""}</span></div>
        <div className="stat"><b>{c.enabled ? "On" : "Off"}</b><span>Assistant switch</span></div>
        <div className="stat"><b>{st.usage.reduce((n, u) => n + u.count, 0)}</b><span>Uses in 30 days</span></div>
      </section>
      <section className="card stack">
        <h2>Settings</h2>
        <p className="small muted">{st.connected ? "When the assistant is on, the text a person asks about is sent to the AI service. Nothing else from the platform is sent." : "No key is set (ANTHROPIC_API_KEY), so every feature uses the built-in rules."} Limits count only uses that reached the AI service.</p>
        <form action={saveAiConfigAction} className="stack">
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> Assistant switched on</label>
          <Field label="Uses per person per day"><input name="perUserPerDay" required inputMode="numeric" defaultValue={c.perUserPerDay} /></Field>
          <Field label="Uses per company per month"><input name="perCompanyPerMonth" required inputMode="numeric" defaultValue={c.perCompanyPerMonth} /></Field>
          <Field label="Uses per visitor per day (public search)"><input name="publicPerDay" required inputMode="numeric" defaultValue={c.publicPerDay} /></Field>
          <button className="btn primary" type="submit">Save settings</button>
        </form>
      </section>
      <section className="card stack">
        <h2>Use in the last 30 days</h2>
        <div className="table-wrap"><table><thead><tr><th>Feature</th><th>Result</th><th>Times</th></tr></thead><tbody>
          {features.flatMap((f) => st.usage.filter((u) => u.feature === f).map((u) => <tr key={`${f}${u.status}`}><td>{u.label}</td><td>{humanize(u.status)}</td><td>{u.count}</td></tr>))}
          {st.usage.length === 0 ? <tr><td colSpan={3} className="muted">Not used yet.</td></tr> : null}
        </tbody></table></div>
      </section>
      <section className="card stack">
        <h2>Audit record</h2>
        <p className="small muted">Each use is recorded with who, which feature and what happened. The text itself is not kept.</p>
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Feature</th><th>Result</th><th>Note</th></tr></thead><tbody>
          {audit.rows.map((r) => <tr key={r.id}><td>{formatDateTime(r.createdAt)}</td><td>{AI_FEATURES[r.feature as AiFeature] ?? r.feature}</td><td><Pill status={r.status === "OK" ? "ACTIVE" : r.status === "ERROR" || r.status === "DENIED" ? "SUSPENDED" : "PENDING"} label={humanize(r.status)} /></td><td className="small">{r.note || "—"}</td></tr>)}
          {audit.rows.length === 0 ? <tr><td colSpan={4} className="muted">Nothing recorded yet.</td></tr> : null}
        </tbody></table></div>
        <div className="row between">{page > 0 ? <Link className="btn" href={`/admin/ai?page=${page - 1}`}>Previous</Link> : <span />}{(page + 1) * audit.pageSize < audit.total ? <Link className="btn" href={`/admin/ai?page=${page + 1}`}>Next</Link> : <span />}</div>
      </section>
    </div>
  );
}
