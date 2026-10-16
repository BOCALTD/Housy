import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { importRowsPage, reconcileImport } from "@/lib/services/imports";
import { humanize } from "@/lib/labels";
import { Flash, Pager, Pill, sp, type SP } from "@/components/ui";
import SaveDocument from "@/components/SaveDocument";
import { commitImportAction, discardImportAction } from "../actions";

export const metadata = { title: "Import preview" };
export const dynamic = "force-dynamic";

const FILTERS = ["READY", "DUPLICATE", "ERROR", "IMPORTED", "FAILED"] as const;

export default async function ImportBatchPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("import.manage");
  const status = sp(searchParams, "status") ?? "";
  const page0 = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [view, recon] = await Promise.all([importRowsPage(member, params.id, { status, page: page0 + 1 }), reconcileImport(member, params.id)]);
  if (!view || !recon) notFound();
  const { batch, rows, total, pageSize } = view;
  const c = recon.counts;
  const href = (p: number) => `/app/import/${batch.id}?${status ? `status=${status}&` : ""}page=${p}`;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 4 }}>
        <p className="small"><Link href="/app/import">All imports</Link></p>
        <h1><span className="mono">{batch.ref}</span> · {humanize(batch.kind)} <Pill status={batch.status} /></h1>
        <p className="small muted">{batch.fileName}</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>{batch.status === "PREVIEWED" ? "What will happen" : "What happened"}</h2>
        <ul>
          <li><strong>{c.READY + c.IMPORTED}</strong> {batch.status === "PREVIEWED" ? "will be created" : "created"}</li>
          <li><strong>{c.DUPLICATE}</strong> skipped as duplicates</li>
          <li><strong>{c.ERROR}</strong> rejected because of a mistake in the file</li>
          {c.FAILED ? <li><strong>{c.FAILED}</strong> could not be created when confirmed</li> : null}
        </ul>
        {batch.status === "PREVIEWED" ? (
          <div className="stack">
            {c.READY === 0 ? <p className="muted">Nothing here can be created. Fix the file and upload it again.</p> : (
              <form action={commitImportAction} className="stack">
                <input type="hidden" name="batchId" value={batch.id} />
                <label className="check"><input type="checkbox" name="confirm" value="yes" required /><span>I have checked the preview and want to create these {c.READY} records.</span></label>
                <div className="row"><button className="btn primary" type="submit">Create {c.READY} records</button></div>
              </form>
            )}
            <form action={discardImportAction}><input type="hidden" name="batchId" value={batch.id} /><button className="btn" type="submit">Discard this import</button></form>
          </div>
        ) : null}
      </section>

      {batch.status === "COMMITTED" ? (
        <section className="card stack">
          <div className="row between"><h2>Reconciliation {recon.balanced ? <Pill status="RECONCILED" label="All checks agree" /> : <Pill status="ERROR" label="Does not agree" />}</h2><SaveDocument url={`/app/import/${batch.id}/report`} fallbackName="import-report.csv" label="Save the report" /></div>
          <p className="small muted">Totals from the file are compared with what is now in the system.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Check</th><th className="r">From the file</th><th className="r">In the system</th><th>Result</th></tr></thead>
            <tbody>{recon.checks.map((k) => <tr key={k.label}><td>{k.label}</td><td className="r">{k.expected}</td><td className="r">{k.actual}</td><td>{k.ok ? <Pill status="RECONCILED" label="Agrees" /> : <Pill status="ERROR" label="Differs" />}</td></tr>)}</tbody>
          </table></div>
        </section>
      ) : null}

      <section className="card stack">
        <div className="row between"><h2>Lines ({total})</h2>{batch.status !== "COMMITTED" ? <SaveDocument url={`/app/import/${batch.id}/report`} fallbackName="import-report.csv" label="Save the report" /> : null}</div>
        <div className="row" role="group" aria-label="Show lines">
          <Link className="btn small" href={`/app/import/${batch.id}`} aria-current={status ? undefined : "true"}>All</Link>
          {FILTERS.map((f) => c[f] > 0 ? <Link key={f} className="btn small" href={`/app/import/${batch.id}?status=${f}`} aria-current={status === f ? "true" : undefined}>{humanize(f)} ({c[f]})</Link> : null)}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Line</th><th>Result</th><th>Record</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const p = r.payload as Record<string, unknown>;
              const cells = (p.cells ?? {}) as Record<string, string>;
              const name = String(p.name ?? p.occupantName ?? cells.name ?? cells.occupantName ?? "");
              return <tr key={r.id}><td className="mono">{r.rowNo}</td><td><Pill status={r.status} /></td><td>{name}</td><td className="small">{r.message}</td></tr>;
            })}
          </tbody>
        </table></div>
        <Pager page={page0} total={total} pageSize={pageSize} href={href} noun="lines" />
      </section>
    </div>
  );
}
