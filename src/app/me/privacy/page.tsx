import { requireUser } from "@/lib/auth";
import { deletionBlocker } from "@/lib/services/privacy";
import { Flash, sp, type SP } from "@/components/ui";
import { deleteAccountAction } from "./actions";

export const metadata = { title: "Your data and privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const blocker = await deletionBlocker(user.id);
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div className="stack" style={{ gap: 6 }}><h1>Your data and privacy</h1><p className="muted">Download what we hold about you, or delete your account.</p></div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <section className="card stack">
        <h2>Download your data</h2>
        <p>A file with your account, companies you belong to, profiles, saved searches, follows, notifications and settings, messages you sent, reviews you wrote, inspections, safety sessions, reports and identity checks. Identity document files and full ID numbers are left out for security; ask support for those.</p>
        <p><a className="btn primary" href="/me/privacy/export" download>Download my data (JSON)</a></p>
      </section>
      <section className="card stack">
        <h2>Delete your account</h2>
        <details className="inline"><summary>What deleting does</summary>
          <ul className="check-list small">
            <li>Removed: your name and email from the account, saved searches, watched properties, follows, notifications and settings, safety locations, your identity checks and agent profile. You are signed out everywhere and cannot sign in again.</li>
            <li>Kept without your name, because other people or the law rely on them: messages others received, reviews tied to real inspections or deals, payments and invoices, Trust and Safety reports and the audit trail.</li>
            <li>Company records (assets, leases, rent) belong to the companies and are not deleted.</li>
          </ul>
        </details>
        {blocker ? <p className="flash error" role="note">{blocker}</p> : (
          <form action={deleteAccountAction} className="stack">
            <label className="field">Your password<input name="password" type="password" required autoComplete="current-password" /></label>
            <label className="field">Type DELETE to confirm<input name="confirm" required autoComplete="off" /></label>
            <button className="btn danger" type="submit">Delete my account</button>
          </form>
        )}
      </section>
    </div>
  );
}
