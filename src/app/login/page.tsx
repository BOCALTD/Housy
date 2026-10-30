import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { CleanInput } from "@/components/CleanInput";
import { ACCOUNT_COPY, AccountTabs } from "@/components/AccountTabs";
import { accountTypeOf } from "@/lib/account-type-rules";
import { safeLocalPath } from "@/lib/security";
import { loginAction } from "../auth-actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const as = accountTypeOf(sp(searchParams, "as"));
  const next = safeLocalPath(sp(searchParams, "next") ?? "", "");
  const copy = ACCOUNT_COPY[as];
  const joinHref = `/join?as=${as}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return (
    <AuthShell
      eyebrow="Welcome back" title="Sign in" intro={copy.signInIntro} photo={copy.photo} points={copy.points}
      foot={<><span>New here? <Link href={joinHref}><strong>Create {as === "personal" ? "a free account" : as === "agent" ? "an agent account" : "a company account"}</strong></Link></span><span><Link href="/forgot">Forgot your password?</Link></span></>}
    >
      <AccountTabs current={as} base="/login" next={next} />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {/* Nothing here is filled in or kept by the browser: each sign-in starts with empty boxes. */}
      <form action={loginAction} className="card stack" autoComplete="off" key={as}>
        <input type="hidden" name="as" value={as} />
        <input type="hidden" name="next" value={next} />
        <Field label={copy.signInEmail}><CleanInput name="email" id="email" type="email" required inputMode="email" placeholder={as === "company" ? "you@yourcompany.com" : "you@example.com"} /></Field>
        <label className="field" htmlFor="password">Password<PasswordInput name="password" id="password" autoComplete="off" noPrefill /></label>
        <details className="inline"><summary>I use two-step sign-in</summary>
          <Field label="Authentication code" hint="From your authenticator app, or one of your recovery codes."><input name="code" id="code" inputMode="text" autoComplete="one-time-code" /></Field>
        </details>
        <button className="btn primary auth-submit" type="submit">Sign in{as === "personal" ? "" : ` as ${copy.tab.toLowerCase()}`}</button>
        <p className="small muted">For your security, sign-in is locked for a while after 3 wrong passwords in a row, and for longer each time it happens again.</p>
      </form>
    </AuthShell>
  );
}
