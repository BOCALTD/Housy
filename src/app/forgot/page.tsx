import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { forgotAction } from "./actions";

export const metadata = { title: "Forgot your password" };

export default function ForgotPage({ searchParams }: { searchParams?: SP }) {
  return (
    <div style={{ maxWidth: 440, marginInline: "auto" }} className="stack">
      <h1>Forgot your password?</h1>
      <p className="muted">Enter the email you signed up with. If it has an account, we send a link to choose a new password.</p>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={forgotAction} className="card stack">
        <Field label="Email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
        <button className="btn primary" type="submit">Send the link</button>
      </form>
      <p className="small muted"><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}
