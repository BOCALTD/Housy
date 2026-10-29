import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { NewPassword } from "@/components/PasswordInput";
import { signupAction } from "../auth-actions";

export const metadata = { title: "Register a company" };

export default async function SignupPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  return (
    <AuthShell
      eyebrow="Company workspace" title="Register your company" intro="You become the Company Super Admin and can invite your agents and staff next."
      photo="/stock/commercial.jpg"
      points={["Publish listings with photos, offers, reels and a street map", "Get verified and show your trust badge on every listing", "Manage tenants, rent, maintenance, deals and documents", "Invite agents; each gets their own profile and reviews"]}
      foot={<span>Already registered? <Link href="/login">Sign in</Link> · Looking for property? <Link href="/join">Create a free account</Link></span>}
    >
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={signupAction} className="card stack">
        <Field label="Company name"><input name="companyName" id="companyName" required autoComplete="organization" /></Field>
        <Field label="Your full name"><input name="name" id="name" required autoComplete="name" /></Field>
        <Field label="Work email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
        <NewPassword />
        <button className="btn primary" type="submit">Create workspace</button>
      </form>
    </AuthShell>
  );
}
