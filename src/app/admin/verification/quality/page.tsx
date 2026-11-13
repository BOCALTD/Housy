import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { complaintsForAdmin, qualityOverview } from "@/lib/services/verification-quality";
import { COMPLAINT_CATEGORIES, COMPLAINT_WORDS, type ComplaintStatus } from "@/lib/verification-quality-rules";
import { day } from "@/app/verification/case-ui";
import { KpiGrid } from "@/app/verification/kpi-ui";
import { decideComplaintAction, housyComplaintAction } from "./actions";

export const metadata = { title: "Verification quality" };
export const dynamic = "force-dynamic";

const PAGE = 10;

export default async function Quality({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const [providers, complaints] = await Promise.all([qualityOverview(admin.id), complaintsForAdmin(admin.id)]);
  const page = Math.max(1, Number(sp(searchParams, "page") || 1));
  const shown = providers.slice((page - 1) * PAGE, page * PAGE);
  return (
    <div className="stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin/verification">Verification network</Link>
        <h1>Quality</h1>
        <p className="muted">Complaints to decide, and each provider&apos;s figures, flags and credentials. A provider with no current licence or certificate of a kind it filed cannot be offered cases until it files one.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Complaints to decide ({complaints.length})</h2>
        {complaints.length === 0 ? <p className="muted small">None open.</p> : (
          <ul className="vp-list">{complaints.map((c) => (
            <li key={c.id} className="stack" style={{ alignItems: "stretch" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <strong>{c.ref} · <Link href={`/admin/verification/providers/${c.providerId}`}>{c.providerName}</Link>{c.caseRef ? <> · <Link href={`/admin/verification/cases/${c.caseRef}`}>{c.caseRef}</Link></> : null}</strong>
                <span className="pill warn">{COMPLAINT_WORDS[c.status as ComplaintStatus]}</span>
              </div>
              <span className="small muted">{COMPLAINT_CATEGORIES.find((x) => x[0] === c.category)?.[1]} · from {c.complainant} · {day(c.createdAt)}</span>
              <p className="small">{c.description}</p>
              <p className="small">{c.providerResponse ? <><strong>Provider&apos;s account:</strong> {c.providerResponse}</> : <span className="muted">The provider has not answered yet.</span>}</p>
              <form action={decideComplaintAction} className="stack">
                <input type="hidden" name="ref" value={c.ref} />
                <Field label="Decision and reasons" hint="Required to uphold or not uphold; both sides see it"><textarea name="note" maxLength={4000} rows={2} /></Field>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {c.status === "OPEN" ? <button className="btn" name="to" value="INVESTIGATING" type="submit">Looking into it</button> : null}
                  <button className="btn" name="to" value="UPHELD" type="submit" data-confirm="Uphold this complaint?" data-confirm-body="It counts against the provider's performance. Both sides are told." data-confirm-ok="Uphold">Uphold</button>
                  <button className="btn" name="to" value="NOT_UPHELD" type="submit" data-confirm="Not uphold this complaint?" data-confirm-ok="Not upheld" data-confirm-tone="default">Not upheld</button>
                </div>
              </form>
            </li>
          ))}</ul>
        )}
        <details className="vp-fold"><summary>Open a complaint as Housy</summary>
          <form action={housyComplaintAction} className="stack">
            <div className="grid-3">
              <Field label="Provider"><select name="providerId" required defaultValue=""><option value="" disabled>Choose…</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Case reference" hint="Optional"><input name="caseRef" maxLength={20} placeholder="HVR-…" /></Field>
              <Field label="About"><select name="category" required defaultValue=""><option value="" disabled>Choose…</option>{COMPLAINT_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            </div>
            <Field label="What happened"><textarea name="description" required minLength={20} maxLength={4000} rows={3} /></Field>
            <button className="btn" type="submit">Open complaint</button>
          </form>
        </details>
      </section>

      <section className="stack">
        <h2>Providers ({providers.length})</h2>
        <p className="small muted">Those with flags or lapsed credentials first.</p>
        {shown.map((p) => (
          <details key={p.id} className="card vp-fold" open={p.kpis.flags.length > 0 || p.credentials.expired.length > 0}>
            <summary><strong>{p.name}</strong> <span className="small muted">{p.providerCode}{p.suspendedAt ? " · suspended" : ""}{p.openComplaints ? ` · ${p.openComplaints} open complaint${p.openComplaints === 1 ? "" : "s"}` : ""}</span></summary>
            <div className="stack">
              {p.credentials.expired.length ? <div className="flash error">No current {p.credentials.expired.map((k) => (k === "LICENCE" ? "licence" : "professional certificate")).join(" or ")}: cannot be offered cases.</div> : null}
              {p.credentials.expiring.length ? <div className="flash warn">Expiring soon: {p.credentials.expiring.map((d) => `${d.title} (${day(d.expiresOn)})`).join(", ")}</div> : null}
              {p.kpis.flags.length ? <div className="flash warn">{p.kpis.flags.join("; ")}.</div> : null}
              <KpiGrid k={p.kpis} />
              <Link className="small" href={`/admin/verification/providers/${p.id}`}>Open the provider</Link>
            </div>
          </details>
        ))}
        {providers.length > PAGE ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            {page > 1 ? <Link className="btn small" href={`?page=${page - 1}`}>Previous</Link> : <span />}
            {page * PAGE < providers.length ? <Link className="btn small" href={`?page=${page + 1}`}>Next</Link> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
