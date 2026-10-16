import { requireUser } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { mfaStatus } from "@/lib/services/account";
import { prisma } from "@/lib/db";
import { MfaConfirm } from "@/components/MfaConfirm";
import { otpauthUri, openSecret } from "@/lib/totp";
import { changePasswordAction, disableMfaAction, signOutOthersAction, startMfaAction } from "./actions";

export const metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams?: SP }) {
  const user = await requireUser();
  const st = await mfaStatus(user.id);
  const pending = st.pending ? await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaSecret: true } }) : null;
  const secret = pending?.mfaSecret ? openSecret(pending.mfaSecret) : null;
  return (
    <div className="stack-lg">
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Two-step sign-in</h2>
        {st.enabled ? (
          <>
            <p>On. You are asked for a code from your authenticator app when you sign in. Recovery codes left: <strong>{st.recoveryLeft}</strong>.</p>
            <form action={disableMfaAction} className="stack">
              <Field label="Your password, to turn it off"><input name="password" type="password" required autoComplete="current-password" /></Field>
              <button className="btn" type="submit">Turn off two-step sign-in</button>
            </form>
          </>
        ) : secret ? (
          <>
            <p>Add this account to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and others). Choose to enter a key, and type:</p>
            <p><code style={{ overflowWrap: "anywhere" }}>{secret}</code></p>
            <details className="inline"><summary>Open it in an app on this phone</summary><p className="small"><a href={otpauthUri(secret, user.email, "Housy")}>Add to authenticator</a></p></details>
            <MfaConfirm />
          </>
        ) : (
          <>
            <p className="muted">Adds a code from your phone to signing in, so a stolen password is not enough. Platform administrators should turn this on.</p>
            <form action={startMfaAction}><button className="btn primary" type="submit">Set up two-step sign-in</button></form>
          </>
        )}
      </section>
      <section className="card stack">
        <h2>Change password</h2>
        <form action={changePasswordAction} className="stack">
          <Field label="Current password"><input name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 10 characters. Your other devices are signed out."><input name="next" type="password" required minLength={10} autoComplete="new-password" /></Field>
          <button className="btn primary" type="submit">Change password</button>
        </form>
      </section>
      <section className="card stack">
        <h2>Devices</h2>
        <p className="muted">Signed in somewhere you do not trust? Sign out of every other device.</p>
        <form action={signOutOthersAction}><button className="btn" type="submit">Sign out other devices</button></form>
      </section>
    </div>
  );
}
