import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { loginAction } from "../auth-actions";

export const metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: { searchParams?: SP }) {
  return (
    <div style={{ maxWidth: 440, marginInline: "auto" }} className="stack">
      <h1>Sign in</h1>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={loginAction} className="card stack">
        <input type="hidden" name="next" value={sp(searchParams, "next") ?? ""} />
        <Field label="Email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><input name="password" id="password" type="password" required autoComplete="current-password" /></Field>
        <button className="btn primary" type="submit">Sign in</button>
      </form>
      <p className="small muted">New company? <Link href="/signup">Register your company</Link></p>
    </div>
  );
}
