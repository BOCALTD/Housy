import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminAwardOverview, readAwardConfig } from "@/lib/services/awards";
import { monthKey, monthLabel } from "@/lib/award-rules";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { computeAction, configAction, disputeDecisionAction, freezeAction, publishAction, verifyAction } from "./actions";

export const metadata = { title: "Top Agent awards" };
export const dynamic = "force-dynamic";

function lastMonths(n: number): string[] {
  const out: string[] = []; const d = new Date();
  for (let i = 1; i <= n; i++) out.push(monthKey(new Date(d.getTime() - i * 30.5 * 864e5)));
  return [...new Set(out)];
}

export default async function AdminAwardsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const [ov, cfg] = await Promise.all([adminAwardOverview(admin.id), readAwardConfig()]);
  const tone = (s: string) => (s === "PUBLISHED" || s === "FROZEN" ? "ACTIVE" : s === "DRAFT" ? "PENDING" : "SUSPENDED");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><p className="eyebrow">Platform Super Super Admin</p><h1>Top Agent awards</h1>
        <p className="muted">Calculate a finished month, check it, publish it, and freeze it after the correction period. Each calculation is a new version and nothing already published changes until you publish the next one. <Link href="/admin">Back to platform administration</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Calculate a month</h2>
        <form action={computeAction} className="row"><Field label="Month"><select name="month">{lastMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></Field><button className="btn primary" type="submit">Calculate</button></form>
      </section>

      <section className="card stack">
        <h2>Calculations ({ov.runs.length})</h2>
        {ov.runs.length === 0 ? <p className="muted">None yet.</p> : (
          <ShowMore noun="more calculations" limit={5} items={ov.runs.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%" }}>
              <div className="row between"><div><strong>{monthLabel(r.month)}</strong> <span className="small muted">version {r.version} · {r.entries} agents · {formatDateTime(r.computedAt)}</span></div><Pill status={tone(r.status)} label={humanize(r.status)} /></div>
              <div className="row">
                <form action={verifyAction}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit">Recompute and check</button></form>
                {r.status === "DRAFT" ? <form action={publishAction}><input type="hidden" name="id" value={r.id} /><button className="btn small primary" type="submit">Publish</button></form> : null}
                {r.status === "PUBLISHED" ? <form action={freezeAction}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit">Freeze</button></form> : null}
                {r.status === "PUBLISHED" || r.status === "FROZEN" ? <Link className="btn small" href={`/awards/${r.month}`}>Open</Link> : null}
              </div>
            </div></li>))} />
        )}
      </section>

      <section className="card stack">
        <h2>Disputes ({ov.disputes.length})</h2>
        {ov.disputes.length === 0 ? <p className="muted">None open.</p> : (
          <ShowMore noun="more disputes" limit={4} items={ov.disputes.map((d) => (
            <li key={d.id}><div className="stack" style={{ width: "100%" }}>
              <p><strong>{d.entry?.displayName ?? "Agent"}</strong> <span className="small muted">rank {d.entry?.rank ?? "–"}</span></p><p>{d.reason}</p>
              <form action={disputeDecisionAction} className="row"><input type="hidden" name="id" value={d.id} /><Field label="Your reason"><input name="note" required minLength={5} /></Field>
                <button className="btn primary" type="submit" name="decision" value="uphold">Uphold</button><button className="btn" type="submit" name="decision" value="reject">Reject</button></form>
            </div></li>))} />
        )}
      </section>

      <section className="card stack">
        <h2>Weights and requirements</h2>
        <form action={configAction} className="stack">
          <div className="fields">
            <Field label="Weight: sales (%)"><input name="wSales" inputMode="numeric" defaultValue={cfg.weights.sales} /></Field>
            <Field label="Weight: posts (%)"><input name="wPosts" inputMode="numeric" defaultValue={cfg.weights.posts} /></Field>
            <Field label="Weight: ratings (%)" hint="The three must add up to 100."><input name="wRating" inputMode="numeric" defaultValue={cfg.weights.rating} /></Field>
            <Field label="Minimum verified sales"><input name="minSales" inputMode="numeric" defaultValue={cfg.minSales} /></Field>
            <Field label="Minimum approved posts"><input name="minPosts" inputMode="numeric" defaultValue={cfg.minPosts} /></Field>
            <Field label="Minimum reviews in the month"><input name="minReviews" inputMode="numeric" defaultValue={cfg.minReviews} /></Field>
            <Field label="Correction period (days)"><input name="windowDays" inputMode="numeric" defaultValue={cfg.windowDays} /></Field>
            <Field label="Show completed deals for (days)" hint="Recently sold, rented and leased."><input name="completedDays" inputMode="numeric" defaultValue={cfg.completedDays} /></Field>
          </div>
          <button className="btn primary" type="submit">Save</button>
        </form>
      </section>
    </div>
  );
}
