import { requireUser } from "@/lib/auth";
import { deletionBlocker } from "@/lib/services/privacy";
import { Flash, sp, type SP } from "@/components/ui";
import { clearSignalsAction, deleteAccountAction, personaliseAction } from "./actions";
import { mySignals } from "@/lib/services/signals";
import { SIGNAL_LABEL, type SignalKind } from "@/lib/suggest-rules";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Your data and privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const [blocker, sig] = await Promise.all([deletionBlocker(user.id), mySignals(user.id)]);
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div className="stack" style={{ gap: 6 }}><h1>Your data and privacy</h1><p className="muted">What shapes your suggestions, what we hold about you, and deleting your account.</p></div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <section className="card stack" id="suggestions" aria-labelledby="sug-h">
        <div className="row between"><h2 id="sug-h">Suggestions for you</h2><span className={`pill ${sig.on ? "ok" : "disc"}`}>{sig.on ? "On" : "Off"}</span></div>
        <p>Properties and reels picked for you come from what you do while signed in: the homes you open, save, ask about and book, the agents you look at, the places you search and the reels you watch. It is kept for 180 days, used only for your own suggestions, and never shown to agents or companies. Nothing is recorded when you are not signed in.</p>
        {sig.on ? (
          sig.count ? (
            <>
              <p className="small">Shaped by {sig.count} thing{sig.count === 1 ? "" : "s"} you did{sig.summary.cities.length ? `, mostly around ${sig.summary.cities.join(", ")}` : ""}.</p>
              <details className="inline"><summary>The latest</summary>
                <ul className="small">{sig.recent.map((r) => <li key={r.id}>{SIGNAL_LABEL[r.kind as SignalKind] ?? r.kind}{r.city ? ` · ${r.city}` : ""} · {formatDateTime(r.createdAt)}</li>)}</ul>
              </details>
            </>
          ) : <p className="small muted">Nothing yet. Suggestions appear once you have looked around.</p>
        ) : <p className="small muted">You see the same properties and reels as everyone else.</p>}
        <div className="row">
          <form action={personaliseAction}><input type="hidden" name="on" value={sig.on ? "no" : "yes"} /><button className="btn" type="submit">{sig.on ? "Turn suggestions off" : "Turn suggestions on"}</button></form>
          {sig.on && sig.count ? <form action={clearSignalsAction}><button className="btn" type="submit">Clear what shapes them</button></form> : null}
        </div>
      </section>
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
