import Link from "next/link";
import { getSession } from "@/lib/auth";
import { findPortalInvite } from "@/lib/services/portals";
import { Flash, sp, type SP } from "@/components/ui";
import { acceptPortalAction } from "../../actions";

export const metadata = { title: "Portal invitation", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AcceptPortal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams?: Promise<SP> }) {
  const { token: raw } = await params;
  const s = await searchParams;
  const token = decodeURIComponent(raw);
  const inv = await findPortalInvite(token).catch(() => null);
  if (!inv) {
    return (
      <div className="card stack" style={{ maxWidth: 520, marginInline: "auto" }}>
        <h1>Invitation not available</h1>
        <p className="muted">This link is invalid, already used, or older than 14 days. Ask the company for a new one.</p>
      </div>
    );
  }
  const session = await getSession();
  const here = `/portal/accept/${encodeURIComponent(token)}`;
  const isInvitee = session?.user.email.toLowerCase() === inv.email;
  const what = inv.kind === "OWNER"
    ? "see the properties they manage for you: listing performance, inspections, tenancies and rent, maintenance and approved reports. You cannot change their records."
    : "see the jobs they assign to you, and send quotations, invoices and completion reports. You will not see the rest of their records.";
  return (
    <div style={{ maxWidth: 560, marginInline: "auto" }} className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">{inv.kind === "OWNER" ? "Owner portal" : "Vendor portal"}</p>
        <h1>{inv.companyName} invited you</h1>
        <p className="muted">The invitation is for <strong>{inv.displayName}</strong> at <strong>{inv.email}</strong>. Accepting lets you {what}</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error") }} />
      {!session ? (
        <div className="card stack">
          <p>Sign in or create an account with {inv.email} to accept.</p>
          <div className="row">
            <Link className="btn primary" href={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
            <Link className="btn" href={`/join?next=${encodeURIComponent(here)}`}>Create an account</Link>
          </div>
        </div>
      ) : !isInvitee ? (
        <div className="card stack">
          <p>You are signed in as {session.user.email}. This invitation is for {inv.email}. Sign out and sign in as that account to accept it.</p>
        </div>
      ) : (
        <form action={acceptPortalAction} className="card stack">
          <input type="hidden" name="token" value={token} />
          <p className="small muted">You can leave at any time by asking the company to remove your access.</p>
          <button className="btn primary" type="submit">Accept invitation</button>
        </form>
      )}
    </div>
  );
}
