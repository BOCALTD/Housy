import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { loginAction } from "../auth-actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  return (
    <div style={{ maxWidth: 440, marginInline: "auto" }} className="stack">
      <h1>Sign in</h1>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={loginAction} className="card stack">
        <input type="hidden" name="next" value={sp(searchParams, "next") ?? ""} />
        <Field label="Email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><input name="password" id="password" type="password" required autoComplete="current-password" /></Field>
        <details className="inline"><summary>I use two-step sign-in</summary>
          <Field label="Authentication code" hint="From your authenticator app, or one of your recovery codes."><input name="code" id="code" inputMode="text" autoComplete="one-time-code" /></Field>
        </details>
        <button className="btn primary" type="submit">Sign in</button>
      </form>
      <p className="small muted"><Link href="/forgot">Forgot your password?</Link></p>
      <p className="small muted">New company? <Link href="/signup">Register your company</Link></p>
    </div>
  );
}
