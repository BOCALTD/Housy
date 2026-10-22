import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { ACCESS_PURPOSES, adminCompany, companyRecordsForAdmin } from "@/lib/services/governance";
import { formatDate, formatDateTime } from "@/lib/dates";
import { TrustBadge } from "@/components/TrustBadge";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { openRecordsAction, restoreCompanyAction, suspendCompanyAction } from "../actions";

export const metadata = { title: "Company" };
export const dynamic = "force-dynamic";

export default async function CompanyAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const { id } = await params;
  const s = await searchParams;
  const admin = await requirePlatformAdmin();
  const c = await adminCompany(admin.id, id);
  if (!c) notFound();
  const records = await companyRecordsForAdmin(admin.id, id).catch(() => null);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow"><Link className="tap" href="/admin/companies">Companies</Link></p>
        <h1>{c.name}</h1>
        <div className="row"><TrustBadge t={c.trust} />{c.suspendedAt ? <Pill status="SUSPENDED" label={`Suspended ${formatDate(c.suspendedAt)}`} /> : <Pill status="ACTIVE" label="Active" />}</div>
        <p className="small muted">Joined {formatDate(c.createdAt)} · {c.counts.members} active members · {c.counts.assets} assets · {c.counts.listings} listings ({c.counts.published} published)</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <div className="two">
        <section className="card stack">
          {c.suspendedAt ? (
            <>
              <h2>Restore</h2>
              <p><strong>Suspended because:</strong> {c.suspendedReason}</p>
              <form action={restoreCompanyAction} className="stack"><input type="hidden" name="id" value={c.id} /><label className="field">Why it is restored<input name="note" required minLength={5} maxLength={1000} /></label><button className="btn primary" type="submit">Restore company</button></form>
            </>
          ) : (
            <details className="inline"><summary>Suspend this company</summary>
              <form action={suspendCompanyAction} className="stack">
                <input type="hidden" name="id" value={c.id} />
                <p className="small">The workspace closes for everyone in the company, its API keys stop, and its listings and profiles leave public view. Nothing is deleted, and you can restore it at any time. The company sees your reason.</p>
                <label className="field">Reason<textarea name="reason" required minLength={5} maxLength={1000} rows={3} /></label>
                <label className="check"><input type="checkbox" name="confirm" value="yes" required /> I have checked this is the right company.</label>
                <button className="btn danger" type="submit">Suspend</button>
              </form>
            </details>
          )}
        </section>
        <section className="card stack" id="records">
          <h2>Company records</h2>
          {records ? (
            <>
              <p className="small">Open until {formatDateTime(records.grant.expiresAt)} for: {ACCESS_PURPOSES[records.grant.purpose as keyof typeof ACCESS_PURPOSES]}. {records.grant.note}</p>
              <details className="inline"><summary>Members ({records.members.length})</summary><ShowMore limit={8} noun="more" items={records.members.map((m, i) => <li key={i}>{m.user.name} · {m.user.email} · {m.role.toLowerCase().replace(/_/g, " ")}{m.status !== "ACTIVE" ? " (suspended)" : ""}</li>)} /></details>
              <details className="inline"><summary>Assets ({records.assets.length})</summary><ShowMore limit={8} noun="more" items={records.assets.map((a) => <li key={a.ref}>{a.ref} · {a.name} · {a.status.toLowerCase()}{a.city ? ` · ${a.city}` : ""}</li>)} /></details>
              <details className="inline"><summary>Listings ({records.listings.length})</summary><ShowMore limit={8} noun="more" items={records.listings.map((l) => <li key={l.publicRef}>{l.publicRef} · {l.title} · {l.status.toLowerCase()}</li>)} /></details>
              <details className="inline"><summary>Leases ({records.leases.length})</summary><ShowMore limit={8} noun="more" items={records.leases.map((l) => <li key={l.ref}>{l.ref} · {l.occupantName} · {l.status.toLowerCase()}</li>)} /></details>
            </>
          ) : (
            <form action={openRecordsAction} className="stack">
              <input type="hidden" name="id" value={c.id} />
              <p className="small">Records open for one hour once you state why. The company&apos;s administrators are told, and they can see every opening in their settings.</p>
              <label className="field">Purpose<select name="purpose" required defaultValue=""><option value="">Choose…</option>{Object.entries(ACCESS_PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field">Case or ticket reference (optional)<input name="caseRef" maxLength={40} /></label>
              <label className="field">What you need to see and why<textarea name="note" required minLength={10} maxLength={1000} rows={2} /></label>
              <button className="btn" type="submit">Open records</button>
            </form>
          )}
          {c.grants.length ? <details className="inline"><summary>Earlier openings ({c.grants.length})</summary><ShowMore limit={5} noun="more" items={c.grants.map((g) => <li key={g.id}>{formatDateTime(g.createdAt)} · {ACCESS_PURPOSES[g.purpose as keyof typeof ACCESS_PURPOSES]}{g.caseRef ? ` · ${g.caseRef}` : ""} · {g.note}</li>)} /></details> : null}
        </section>
      </div>
    </div>
  );
}
