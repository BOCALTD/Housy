import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { safeLocalPath } from "@/lib/security";
import { REAUTH_MINUTES } from "@/lib/reauth-rules";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { confirmAction } from "./actions";

export const metadata = { title: "Confirm it's you", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ConfirmPage({ searchParams: spP }: { searchParams?: Promise<SP> }) {
  const searchParams = await spP;
  const back = safeLocalPath(sp(searchParams, "back") ?? "", "/") || "/";
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(back)}`);
  const mfa = !!session.user.mfaEnabledAt;
  return (
    <AuthShell eyebrow="Security check" title="Confirm it's you" points={["Asked again after 15 minutes", "Five wrong tries signs this device out", "The account owner is emailed if that happens"]} intro={`This area holds keys, money or people's details. Enter your password${mfa ? " and a code from your authenticator app" : ""} to continue. You will not be asked again for ${REAUTH_MINUTES} minutes while you keep working here.`}>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      {sp(searchParams, "again") ? <p className="flash warning" role="note">Your last confirmation had expired, so that was not saved. Confirm, then do it again.</p> : null}
      <form action={confirmAction} className="stack">
        <input type="hidden" name="back" value={back} />
        <p className="small muted">Signed in as {session.user.email}</p>
        <input type="email" name="username" autoComplete="username" defaultValue={session.user.email} hidden readOnly />
        <Field label="Password"><PasswordInput name="password" id="confirm-password" autoComplete="current-password" required /></Field>
        {mfa ? <Field label="Two-step code" hint="The 6-digit code from your authenticator app, or a recovery code."><input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={20} /></Field> : null}
        <button className="btn primary" type="submit">Confirm</button>
      </form>
      <p className="small"><Link href="/forgot">Forgot your password?</Link> · <Link href="/">Go back to the homepage</Link></p>
    </AuthShell>
  );
}
