import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { signupAction } from "../auth-actions";

export const metadata = { title: "Register a company" };

export default async function SignupPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  return (
    <div style={{ maxWidth: 520, marginInline: "auto" }} className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Company workspace</p>
        <h1>Register your company</h1>
        <p className="muted">You become the Company Super Admin and can invite your staff next.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={signupAction} className="card stack">
        <Field label="Company name"><input name="companyName" id="companyName" required autoComplete="organization" /></Field>
        <Field label="Your full name"><input name="name" id="name" required autoComplete="name" /></Field>
        <Field label="Work email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" hint="At least 10 characters.">
          <input name="password" id="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <button className="btn primary" type="submit">Create workspace</button>
      </form>
      <p className="small muted">Already registered? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
