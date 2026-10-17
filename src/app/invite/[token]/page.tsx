import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findInvitation } from "@/lib/services/companies";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { acceptInviteAction } from "../../auth-actions";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params: paramsP, searchParams: searchP }: { params: Promise<{ token: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const token = decodeURIComponent(params.token);
  const inv = await findInvitation(token);
  const valid = inv && !inv.acceptedAt && inv.expiresAt > new Date();
  if (!valid) {
    return (
      <div className="card stack" style={{ maxWidth: 520, marginInline: "auto" }}>
        <h1>Invitation not available</h1>
        <p className="muted">This invitation is invalid, already used, or has expired. Ask the company administrator for a new one.</p>
      </div>
    );
  }
  const session = await getSession();
  const hasAccount = !!(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  const signedInAsInvitee = session?.user.email === inv.email;

  return (
    <div style={{ maxWidth: 520, marginInline: "auto" }} className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Invitation</p>
        <h1>Join as {ROLE_LABELS[inv.role as Role]}</h1>
        <p className="muted">This invitation is for <strong>{inv.email}</strong>.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      {hasAccount && !signedInAsInvitee ? (
        <div className="card stack">
          <p>An account already exists for {inv.email}. Sign in as that account, then open this link again.</p>
          <Link className="btn primary" href={`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`}>Sign in</Link>
        </div>
      ) : (
        <form action={acceptInviteAction} className="card stack">
          <input type="hidden" name="token" value={token} />
          {!hasAccount ? (
            <>
              <Field label="Your full name"><input name="name" id="name" required autoComplete="name" /></Field>
              <Field label="Choose a password" hint="At least 10 characters.">
                <input name="password" id="password" type="password" required minLength={10} autoComplete="new-password" />
              </Field>
            </>
          ) : null}
          <button className="btn primary" type="submit">Accept invitation</button>
        </form>
      )}
    </div>
  );
}
