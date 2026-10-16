import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/labels";

export const metadata = { title: "Help and support" };
export const dynamic = "force-dynamic";

export default function SupportPage() {
  const email = process.env.SUPPORT_EMAIL?.trim();
  const phone = process.env.SUPPORT_PHONE?.trim();
  const hours = process.env.SUPPORT_HOURS?.trim();
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <h1>Help and support</h1>
      <section className="card stack">
        <h2>Contact us</h2>
        {email || phone ? (
          <ul>
            {email ? <li>Email: <a href={`mailto:${email}`}>{email}</a></li> : null}
            {phone ? <li>Phone: <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a></li> : null}
            {hours ? <li>Hours: {hours}</li> : null}
          </ul>
        ) : <p className="muted">Support contact details have not been set up yet. Ask your company administrator.</p>}
        <p className="small muted">Say which page you were on, what you expected and what happened. Never send your password or a two-step code to anyone, including us. {PLATFORM_NAME} staff will never ask for them.</p>
      </section>

      <section className="card stack">
        <h2>Cannot sign in</h2>
        <details className="inline"><summary>I forgot my password</summary>
          <p>Use <Link href="/forgot">Forgot password</Link>. We send a one-time link to your email address that works for 60 minutes. If it does not arrive within a few minutes, check your spam folder and that you used the address you registered with.</p>
        </details>
        <details className="inline"><summary>I lost my phone with the authenticator app</summary>
          <p>Sign in with the password and one of the ten recovery codes you saved when you turned two-step sign-in on (open "I use two-step sign-in" on the sign-in page and type it there). Each recovery code works once. If you have none left, contact support: we will confirm who you are through your company administrator before removing two-step sign-in.</p>
        </details>
        <details className="inline"><summary>I think someone else has used my account</summary>
          <p>Change your password at <Link href="/me/security">Sign-in security</Link>, which also signs out every other device, and turn on two-step sign-in. Then tell your company administrator and contact support.</p>
        </details>
        <details className="inline"><summary>I was invited to a company but the link does not work</summary>
          <p>An invitation works once, for the email address it was sent to, for 7 days. Ask your company administrator to send a new one from Team.</p>
        </details>
      </section>

      <section className="card stack">
        <h2>Money looks wrong</h2>
        <p>Receipts and payments are never edited or deleted; mistakes are corrected by a new entry that names who made it and why. If a balance, receipt or payment looks wrong, tell your company administrator first. They can reverse a receipt or request an adjustment. If they cannot explain it, contact support with the lease reference and the receipt number.</p>
      </section>
    </div>
  );
}
