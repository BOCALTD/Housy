import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { PasswordInput } from "@/components/PasswordInput";
import { CleanInput } from "@/components/CleanInput";
import { Logo } from "@/components/Logo";
import { getSession } from "@/lib/auth";
import { adminLoginAction } from "../../auth-actions";

// Staff sign-in. Not linked from anywhere, not in the sitemap, and kept out of search engines.
export const metadata: Metadata = { title: "Staff sign-in", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function StaffSignIn({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const session = await getSession();
  if (session?.user.isPlatformAdmin) redirect("/admin");
  return (
    <div className="staff-auth">
      <div className="staff-card stack">
        <Logo height={32} />
        <div>
          <p className="eyebrow">Housy staff</p>
          <h1>Sign in</h1>
          <p className="muted small">For platform administrators only. Every sign-in is recorded and reported to the account holder.</p>
        </div>
        <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
        <form action={adminLoginAction} className="stack" autoComplete="off">
          <Field label="Staff email"><CleanInput name="email" id="email" type="email" required inputMode="email" /></Field>
          <label className="field" htmlFor="password">Password<PasswordInput name="password" id="password" autoComplete="off" noPrefill /></label>
          <Field label="Authentication code" hint="From your authenticator app, or a recovery code. Needed once two-step sign-in is on."><input name="code" id="code" inputMode="text" autoComplete="one-time-code" /></Field>
          <button className="btn primary auth-submit" type="submit">Sign in</button>
        </form>
        <p className="small muted">Sessions end after 8 hours. Sign-in locks after repeated wrong attempts.</p>
      </div>
    </div>
  );
}
