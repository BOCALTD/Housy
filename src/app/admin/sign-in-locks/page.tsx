import { requirePlatformAdmin } from "@/lib/auth";
import { signInLocks } from "@/lib/services/login-guard";
import { LADDER, waitText } from "@/lib/login-lock-rules";
import { formatDateTime } from "@/lib/dates";
import { Flash, Pill, sp, type SP } from "@/components/ui";
import { liftLockAction } from "./actions";

export const metadata = { title: "Sign-in locks" };
export const dynamic = "force-dynamic";

export default async function SignInLocksPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const rows = await signInLocks(admin.id);
  const closed = rows.filter((r) => r.state.kind === "banned"), locked = rows.filter((r) => r.state.kind === "locked");
  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <li className="card stack">
      <div className="row between">
        <div><strong>{r.user ? `${r.user.name} · ${r.user.email}` : "No account with this email"}</strong>
          <div className="small muted">{r.rounds} lock{r.rounds === 1 ? "" : "s"} so far · last wrong password {r.lastFailedAt ? formatDateTime(r.lastFailedAt) : "unknown"}</div></div>
        <Pill status={r.state.kind === "banned" ? "SUSPENDED" : "PENDING"} label={r.state.kind === "banned" ? "Closed" : `Locked ${r.state.kind === "locked" ? waitText(r.state.until) : ""}`} />
      </div>
      {r.user ? (
        <details className="inline"><summary>{r.state.kind === "banned" ? "Reopen this account" : "Lift the lock now"}</summary>
          <form action={liftLockAction} className="stack">
            <input type="hidden" name="key" value={r.key} />
            <label className="field">Why (kept in the activity log)<input name="reason" required minLength={5} maxLength={300} placeholder="For example: owner confirmed by phone and ID" /></label>
            <p className="small muted">Confirm the person is the owner first, from the email address on the account. Lifting starts their count from zero.</p>
            <button className="btn primary" type="submit">{r.state.kind === "banned" ? "Reopen" : "Lift the lock"}</button>
          </form>
        </details>
      ) : null}
    </li>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Sign-in locks</h1>
        <p className="muted">Three wrong passwords in a row lock sign-in for an account: {LADDER.map((h) => `${h}`).join(", ")} hours, longer each time. Three more after the {LADDER[LADDER.length - 1]}-hour lock close the account until someone here reopens it. A right password resets the count; a password reset from the email link ends a lock but not a closure. Locks count per email address, including addresses with no account, so the sign-in page never shows which emails are registered.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="stack"><h2>Closed accounts ({closed.length})</h2>
        {closed.length ? <ul className="card-list">{closed.map((r) => <Row key={r.key} r={r} />)}</ul> : <div className="card"><p className="muted">No closed accounts.</p></div>}</section>
      <section className="stack"><h2>Locked now ({locked.length})</h2>
        {locked.length ? <ul className="card-list">{locked.map((r) => <Row key={r.key} r={r} />)}</ul> : <div className="card"><p className="muted">Nothing is locked right now.</p></div>}</section>
    </div>
  );
}
