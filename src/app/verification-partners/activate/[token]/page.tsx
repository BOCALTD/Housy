import Link from "next/link";
import { NewPassword } from "@/components/PasswordInput";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findProviderInvitation } from "@/lib/services/verification-network";
import { VP_ROLE_LABELS, VP_ROLE_SUMMARY } from "@/lib/verification-network-rules";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { acceptProviderInviteAction } from "../../actions";

export const metadata = { title: "Join a verification organisation", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Activation of an approved organisation by its authorised representative, and invitations for its staff: one page for both. */
export default async function Activate({ params: p, searchParams: s }: { params: Promise<{ token: string }>; searchParams?: Promise<SP> }) {
  const { token: raw } = await p;
  const searchParams = await s;
  const token = decodeURIComponent(raw);
  const inv = await findProviderInvitation(token);
  const usable = inv && !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date() && inv.provider?.status === "APPROVED" && !inv.provider.suspendedAt;
  if (!usable) {
    return (
      <div className="wrap"><div className="card stack" style={{ maxWidth: 560, marginInline: "auto" }}>
        <h1>Invitation not available</h1>
        <p className="muted">This invitation is invalid, already used, cancelled or has expired. Ask whoever invited you for a new one{inv?.role === "OWNER" ? " (for the first owner, that is Housy: reply to the approval message)" : ""}.</p>
      </div></div>
    );
  }
  const session = await getSession();
  const hasAccount = !!(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  const signedInAsInvitee = session?.user.email === inv.email;
  const owner = inv.role === "OWNER";
  return (
    <div className="wrap"><div style={{ maxWidth: 560, marginInline: "auto" }} className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">{owner ? "Activate your organisation" : "Invitation"}</p>
        <h1>{inv.provider!.name}</h1>
        <p className="muted">Provider {inv.provider!.providerCode} · {owner ? "You are invited to activate its account as" : "Join as"} <strong>{VP_ROLE_LABELS[inv.role]}</strong>. This invitation is for <strong>{inv.email}</strong>.</p>
        <p className="small muted">{VP_ROLE_SUMMARY[inv.role]}</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      {session && !signedInAsInvitee ? (
        <div className="card stack">
          <p>You are signed in as {session.user.email}, but this invitation is for {inv.email}. Sign out, then open this link again and sign in or create the account for {inv.email}.</p>
        </div>
      ) : hasAccount && !signedInAsInvitee ? (
        <div className="card stack">
          <p>An account already exists for {inv.email}. Sign in to it, then you will come back here.</p>
          <Link className="btn primary" href={`/login?next=${encodeURIComponent(`/verification-partners/activate/${raw}`)}`}>Sign in</Link>
        </div>
      ) : (
        <form action={acceptProviderInviteAction} className="card stack">
          <input type="hidden" name="token" value={token} />
          {!hasAccount ? (
            <>
              <p className="small muted">Create your account. Your email is confirmed by this invitation, which was sent to it.</p>
              <Field label="Your full name"><input name="name" id="name" required autoComplete="name" maxLength={120} /></Field>
              <NewPassword label="Choose a password" />
            </>
          ) : null}
          <button className="btn primary" type="submit">{owner ? "Activate the organisation" : "Accept invitation"}</button>
        </form>
      )}
    </div></div>
  );
}
