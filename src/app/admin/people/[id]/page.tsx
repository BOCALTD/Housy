import { CountryBadge } from "@/components/CountryBadge";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { personForAdmin } from "@/lib/services/account-moderation";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { removeUserAction, restoreUserAction, suspendUserAction } from "../actions";

export const metadata = { title: "Person" };
export const dynamic = "force-dynamic";

const ACTION_WORDS: Record<string, string> = { "user.suspended": "Suspended", "user.restored": "Restored", "user.removed": "Removed permanently", "auth.account_closed": "Closed after repeated wrong passwords", "auth.account_reopened": "Reopened after a sign-in lock" };

export default async function Person({ params: p, searchParams: s }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const { id } = await p;
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const u = await personForAdmin(admin.id, id);
  if (!u) notFound();
  const hidden = <input type="hidden" name="id" value={u.id} />;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin/people">People</Link>
        <h1 style={{ overflowWrap: "anywhere" }}>{u.name} <CountryBadge country={u.country} /></h1>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {u.removedAt ? <span className="pill bad">Removed {formatDate(u.removedAt)}</span> : u.suspendedAt ? <span className="pill warn">Suspended {formatDate(u.suspendedAt)}</span> : <span className="pill ok">Active</span>}
          <span className="small muted" style={{ overflowWrap: "anywhere" }}>{u.removedAt ? "Details erased" : `${u.email}${u.phone ? ` · ${u.phone}` : ""}`} · joined {formatDate(u.createdAt)} · {u.sessions} signed-in device{u.sessions === 1 ? "" : "s"}</span>
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {u.suspendedAt && u.suspendedReason ? <div className="flash warn"><strong>Reason:</strong> {u.suspendedReason}</div> : null}

      <section className="card stack">
        <h2>Workspaces</h2>
        {u.memberships.length ? <ul className="vp-list">{u.memberships.map((m) => (
          <li key={m.company.id}><Link href={`/admin/companies/${m.company.id}`}><strong>{m.company.name}</strong><span className="small muted">{humanize(m.role)} · {humanize(m.status)}{m.company.businessType === "INDEPENDENT_AGENT" ? " · their own agent workspace" : ""}</span></Link>{m.company.suspendedAt ? <span className="pill warn">Suspended</span> : null}</li>
        ))}</ul> : <p className="muted small">None.</p>}
      </section>

      {u.isPlatformAdmin || u.removedAt ? null : (
        <section className="card stack">
          <h2>Act on this account</h2>
          {u.suspendedAt ? (
            <form action={restoreUserAction} className="stack">{hidden}
              <Field label="Why it is restored" hint="Recorded, and sent to them"><textarea name="reason" required minLength={10} maxLength={1000} rows={2} /></Field>
              <div className="row"><button className="btn primary" type="submit" data-confirm="Restore this account?" data-confirm-body="They can sign in again; their profiles and their own agent workspace come back." data-confirm-ok="Restore" data-confirm-tone="default">Restore the account</button></div>
            </form>
          ) : (
            <form action={suspendUserAction} className="stack">{hidden}
              <p className="small muted">For shady activity: fraud, fake listings, scams, harassment. They are signed out everywhere and cannot sign in; their agent profiles and their own agent workspace leave public view. Nothing is deleted, and you can restore it.</p>
              <Field label="Reason" hint="Recorded, and sent to them by email"><textarea name="reason" required minLength={10} maxLength={1000} rows={2} /></Field>
              <div className="row"><button className="btn danger" type="submit" data-confirm="Suspend this account?" data-confirm-body="They are signed out everywhere and told why." data-confirm-ok="Suspend">Suspend the account</button></div>
            </form>
          )}
          <details className="vp-fold">
            <summary>Remove permanently</summary>
            <form action={removeUserAction} className="stack">{hidden}
              <p className="small">This cannot be undone. Their personal details are erased, any company where they are the only top administrator is suspended, and their email address and phone number can never be used to join again. Payments, invoices, messages others received, case records and the audit trail are kept without their name.</p>
              <Field label="Reason" hint="Recorded"><textarea name="reason" required minLength={10} maxLength={1000} rows={2} /></Field>
              <Field label="Type REMOVE to confirm"><input name="confirm" required autoComplete="off" pattern="[Rr][Ee][Mm][Oo][Vv][Ee]" /></Field>
              <div className="row"><button className="btn danger" type="submit" data-confirm="Remove this account permanently?" data-confirm-body="Their details are erased and they can never join again with this email or phone. This cannot be undone." data-confirm-ok="Remove permanently">Remove permanently</button></div>
            </form>
          </details>
        </section>
      )}

      <section className="card stack">
        <h2>History</h2>
        {u.history.length ? <ul className="vp-list">{u.history.map((h, i) => {
          const d = (h.detail ?? {}) as { reason?: string; note?: string };
          return <li key={i}><span className="stack" style={{ gap: 2, minWidth: 0 }}><strong>{ACTION_WORDS[h.action] ?? h.action}</strong><span className="small muted">{formatDateTime(h.createdAt)}{d.reason || d.note ? ` · ${d.reason ?? d.note}` : ""}</span></span></li>;
        })}</ul> : <p className="muted small">Nothing recorded.</p>}
      </section>
    </div>
  );
}
