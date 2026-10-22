import { statementPeriod } from "@/lib/portal-rules";

/** Choose a period and download the owner statement as a PDF. Plain links and a GET form, so it works without scripts. */
export function StatementForm({ action }: { action: string }) {
  const today = new Date();
  const last = statementPeriod(null, null, today);
  const t = today.toISOString().slice(0, 10);
  const yearStart = `${t.slice(0, 4)}-01-01`;
  const q = (from: string, to: string) => `${action}?from=${from}&to=${to}`;
  const monthName = new Date(`${last.from}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="stack">
      <div className="row">
        <a className="btn primary" href={q(last.from, last.to)}>Download {monthName} (PDF)</a>
        <a className="btn" href={q(yearStart, t)}>This year so far (PDF)</a>
      </div>
      <details className="inline"><summary>Choose other dates</summary>
        <form method="get" action={action} className="stack" style={{ gap: 8 }}>
          <div className="fields">
            <label className="field">From<input type="date" name="from" required defaultValue={last.from} max={t} /></label>
            <label className="field">To<input type="date" name="to" required defaultValue={last.to} max={t} /></label>
          </div>
          <div className="row"><button className="btn" type="submit">Download statement (PDF)</button></div>
          <p className="small muted">Up to one year at a time.</p>
        </form>
      </details>
    </div>
  );
}
