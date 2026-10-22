import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { joinAction } from "../auth-actions";

export const metadata = { title: "Create an account" };

export default async function JoinPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  return (
    <div style={{ maxWidth: 520, marginInline: "auto" }} className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">For people looking for property</p>
        <h1>Create an account</h1>
        <p className="muted">Follow agents, companies and developers, save what you are looking for, and message agents. A company that manages property registers separately.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={joinAction} className="card stack">
        <input type="hidden" name="next" value={sp(searchParams, "next") ?? ""} />
        <Field label="Your full name"><input name="name" id="name" required autoComplete="name" /></Field>
        <Field label="Email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" hint="At least 10 characters."><input name="password" id="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <button className="btn primary" type="submit">Create account</button>
      </form>
      <p className="small muted">Already have an account? <Link href="/login">Sign in</Link> · Managing property for a company? <Link href="/signup">Register your company</Link></p>
    </div>
  );
}
