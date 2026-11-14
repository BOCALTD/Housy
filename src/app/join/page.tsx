import { Captcha } from "@/components/Captcha";
import Link from "next/link";
import { headers } from "next/headers";
import { visitorCountry } from "@/lib/countries";
import { PhoneField } from "@/components/PhoneField";
import { BusinessCountry } from "@/components/BusinessCountry";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";
import { signedInAs } from "@/lib/session-label";
import { SessionSwitch } from "@/components/SessionSwitch";
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
  const country = visitorCountry(await headers());
  const me = await signedInAs();
  const gate = me ? <SessionSwitch name={me.name} role={me.role} goingTo="create a new account" stayHref={me.home} /> : null;
  const signIn = (t: string) => `/login?as=${t}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  // First, choose the kind of account; each one asks only for what it needs.
  if (!raw) {
    return (
      <AuthShell eyebrow="Get started" title={`How will you use ${PLATFORM_NAME}?`} intro="Choose one. You can always look for property from any account."
        points={["Verified companies and agents", "Every inspection booked and tracked", "Rent, documents and deals in one place"]}
        foot={<span>Already have an account? <Link href={signIn("personal")}><strong>Sign in</strong></Link></span>}>
        {gate}
        <AccountTabs current={null} base="/join" next={next} cards />
      </AuthShell>
    );
  }

  const as = accountTypeOf(raw);
  const copy = ACCOUNT_COPY[as];
  return (
    <AuthShell eyebrow="Create an account" title={copy.joinTitle} intro={copy.joinIntro} photo={copy.photo} points={copy.points}
      foot={<span>Already have an account? <Link href={signIn(as)}><strong>Sign in</strong></Link></span>}>
      {gate}
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
              <Field label="Company name" hint="As registered with your country's company registry."><input name="companyName" id="companyName" required maxLength={160} autoComplete="organization" /></Field>
              <BusinessCountry value={country} />
              <Field label="CAC registration number (Nigeria, optional)" hint="For example RC 1234567 or BN 1234567. It is checked when you verify the company."><input name="cacNumber" id="cacNumber" maxLength={20} autoComplete="off" /></Field>
              <Field label="Company email" hint="Use your company's own email address. It is how you sign in and where we write to the company.">
                <input name="email" id="email" type="email" required autoComplete="off" inputMode="email" placeholder="you@yourcompany.com" autoCapitalize="off" spellCheck={false} />
              </Field>
              <label className="check"><input type="checkbox" name="noCompanyDomain" /><span>Our company does not have its own email domain yet (we use Gmail, Yahoo or similar). The company check is then done by hand.</span></label>
              <PhoneField label="Company phone (optional)" country={country} />
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
            <BusinessCountry value={country} label="Country where you work" />
            <Field label="Email"><input name="email" id="email" type="email" required autoComplete="off" inputMode="email" autoCapitalize="off" spellCheck={false} /></Field>
            <PhoneField label="Phone" required country={country} hint="Clients reach you through the platform; your number is used for verification." />
            <NewPassword />
            <p className="small muted auth-note">Employed by an agency? Ask its administrator to invite you, so you join the company&apos;s workspace and your listings carry its name.</p>
          </>
        ) : (
          <>
            <Field label="Your full name"><input name="name" id="name" required maxLength={120} autoComplete="name" /></Field>
            <Field label="Email"><input name="email" id="email" type="email" required autoComplete="off" inputMode="email" autoCapitalize="off" spellCheck={false} /></Field>
            <PhoneField label="Phone (optional)" country={country} hint="Only shared with an agent when you book an inspection." />
            <NewPassword />
          </>
        )}
        <label className="check consent"><input type="checkbox" name="agree" required /><span>I am 18 or over and I agree to the <Link href="/legal/terms" target="_blank">Terms of use</Link> and <Link href="/legal/privacy" target="_blank">Privacy policy</Link>.</span></label>
        <Captcha place="signup" />
        <button className="btn primary auth-submit" type="submit">{as === "company" ? "Create the company workspace" : as === "agent" ? "Create my agent account" : "Create my account"}</button>
        <p className="small muted">Use {PLATFORM_NAME} honestly: read the <Link href="/legal/community">community guidelines</Link> and <Link href="/safety">how we verify</Link>.</p>
      </form>
    </AuthShell>
  );
}
