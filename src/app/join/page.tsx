import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { NewPassword } from "@/components/PasswordInput";
import { joinAction } from "../auth-actions";

export const metadata = { title: "Create an account" };

export default async function JoinPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  return (
    <AuthShell
      eyebrow="Free account" title="Create an account" intro="For people looking for property, and for agents building their own profile."
      points={["Every photo and detail of each property", "Save homes and get alerts for new ones", "Book inspections and message agents safely", "Find a flatmate who lives the way you do"]}
      foot={<span>Already have an account? <Link href="/login">Sign in</Link> · Managing property for a company? <Link href="/signup">Register your company</Link></span>}
    >
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={joinAction} className="card stack">
        <input type="hidden" name="next" value={sp(searchParams, "next") ?? ""} />
        <Field label="Your full name"><input name="name" id="name" required autoComplete="name" /></Field>
        <Field label="Email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
        <NewPassword />
        <button className="btn primary" type="submit">Create account</button>
      </form>
    </AuthShell>
  );
}
