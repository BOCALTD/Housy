import Link from "next/link";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { NewPassword } from "@/components/PasswordInput";
import { ACCOUNT_COPY, AccountTabs } from "@/components/AccountTabs";
import { BUSINESS_TYPES, accountTypeOf } from "@/lib/account-type-rules";
import { safeLocalPath } from "@/lib/security";
import { PLATFORM_NAME } from "@/lib/labels";
import { joinAction } from "../auth-actions";

export const metadata = { title: "Create an account" };

export default async function JoinPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const raw = sp(searchParams, "as");
  const next = safeLocalPath(sp(searchParams, "next") ?? "", "");
  const signIn = (t: string) => `/login?as=${t}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  // First, choose the kind of account; each one asks only for what it needs.
  if (!raw) {
    return (
      <AuthShell eyebrow="Get started" title={`How will you use ${PLATFORM_NAME}?`} intro="Choose one. You can always look for property from any account."
        points={["Verified companies and agents", "Every inspection booked and tracked", "Rent, documents and deals in one place"]}
        foot={<span>Already have an account? <Link href={signIn("personal")}><strong>Sign in</strong></Link></span>}>
        <AccountTabs current={null} base="/join" next={next} cards />
      </AuthShell>
    );
  }

  const as = accountTypeOf(raw);
  const copy = ACCOUNT_COPY[as];
  return (
    <AuthShell eyebrow="Create an account" title={copy.joinTitle} intro={copy.joinIntro} photo={copy.photo} points={copy.points}
      foot={<span>Already have an account? <Link href={signIn(as)}><strong>Sign in</strong></Link></span>}>
      <AccountTabs current={as} base="/join" next={next} />
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={joinAction} className="card stack" key={as}>
        <input type="hidden" name="as" value={as} />
        <input type="hidden" name="next" value={next} />
        {as === "company" ? (
          <>
            <fieldset className="auth-group">
              <legend>Your company</legend>
              <Field label="What does your company do?">
                <select name="businessType" id="businessType" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {Object.entries(BUSINESS_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Company name" hint="As registered with the CAC."><input name="companyName" id="companyName" required maxLength={160} autoComplete="organization" /></Field>
              <Field label="CAC registration number (optional)" hint="For example RC 1234567 or BN 1234567. It is checked when you verify the company."><input name="cacNumber" id="cacNumber" maxLength={20} autoComplete="off" /></Field>
              <Field label="Company email" hint="Use your company's own email address. It is how you sign in and where we write to the company.">
                <input name="email" id="email" type="email" required autoComplete="off" inputMode="email" placeholder="you@yourcompany.com" autoCapitalize="off" spellCheck={false} />
              </Field>
              <label className="check"><input type="checkbox" name="noCompanyDomain" /><span>Our company does not have its own email domain yet (we use Gmail, Yahoo or similar). The company check is then done by hand.</span></label>
              <Field label="Company phone (optional)"><input name="phone" id="phone" type="tel" inputMode="tel" maxLength={30} autoComplete="off" placeholder="0803 123 4567" /></Field>
            </fieldset>
            <fieldset className="auth-group">
              <legend>You, the administrator</legend>
              <Field label="Your full name"><input name="name" id="name" required maxLength={120} autoComplete="name" /></Field>
              <NewPassword />
            </fieldset>
          </>
        ) : as === "agent" ? (
          <>
            <Field label="Your full name" hint="As clients will see it on your profile."><input name="name" id="name" required maxLength={120} autoComplete="name" /></Field>
            <Field label="Business or trading name (optional)" hint="Leave blank if you trade under your own name."><input name="tradingName" id="tradingName" maxLength={160} autoComplete="off" /></Field>
            <Field label="Email"><input name="email" id="email" type="email" required autoComplete="off" inputMode="email" autoCapitalize="off" spellCheck={false} /></Field>
            <Field label="Phone" hint="Clients reach you through the platform; your number is used for verification."><input name="phone" id="phone" type="tel" required inputMode="tel" maxLength={30} autoComplete="off" placeholder="0803 123 4567" /></Field>
            <NewPassword />
            <p className="small muted auth-note">Employed by an agency? Ask its administrator to invite you, so you join the company&apos;s workspace and your listings carry its name.</p>
          </>
        ) : (
          <>
            <Field label="Your full name"><input name="name" id="name" required maxLength={120} autoComplete="name" /></Field>
            <Field label="Email"><input name="email" id="email" type="email" required autoComplete="off" inputMode="email" autoCapitalize="off" spellCheck={false} /></Field>
            <Field label="Phone (optional)" hint="Only shared with an agent when you book an inspection."><input name="phone" id="phone" type="tel" inputMode="tel" maxLength={30} autoComplete="off" placeholder="0803 123 4567" /></Field>
            <NewPassword />
          </>
        )}
        <button className="btn primary auth-submit" type="submit">{as === "company" ? "Create the company workspace" : as === "agent" ? "Create my agent account" : "Create my account"}</button>
        <p className="small muted">By creating an account you agree to use {PLATFORM_NAME} honestly. Read <Link href="/trust">Trust and Safety</Link> and <Link href="/safety">how we verify</Link>.</p>
      </form>
    </AuthShell>
  );
}
