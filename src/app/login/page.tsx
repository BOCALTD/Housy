import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { loginAction } from "../auth-actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  return (
    <AuthShell
      eyebrow="Welcome back" title="Sign in" intro="Use the email address and password for your account."
      points={["Your saved homes, alerts and messages", "Inspections, offers and documents in one place", "Company workspaces for listings, tenants and rent"]}
      foot={<><span><Link href="/forgot">Forgot your password?</Link></span><span>New here? <Link href="/join">Create a free account</Link> · <Link href="/signup">Register a company</Link></span></>}
    >
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {/* Sign-in details are not filled in or remembered by the browser on this form. */}
      <form action={loginAction} className="card stack" autoComplete="off">
        <input type="hidden" name="next" value={sp(searchParams, "next") ?? ""} />
        <Field label="Email"><input name="email" id="email" type="email" required autoComplete="off" autoCapitalize="off" spellCheck={false} data-lpignore="true" data-1p-ignore="" /></Field>
        <label className="field" htmlFor="password">Password<PasswordInput name="password" id="password" autoComplete="off" /></label>
        <details className="inline"><summary>I use two-step sign-in</summary>
          <Field label="Authentication code" hint="From your authenticator app, or one of your recovery codes."><input name="code" id="code" inputMode="text" autoComplete="one-time-code" /></Field>
        </details>
        <button className="btn primary" type="submit">Sign in</button>
        <p className="small muted">For your security, an account is locked for a while after 3 wrong passwords in a row, and for longer each time it happens again.</p>
      </form>
    </AuthShell>
  );
}
