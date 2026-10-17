import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listImports } from "@/lib/services/imports";
import { ASSET_COLUMNS, LEASE_COLUMNS, MAX_IMPORT_ROWS } from "@/lib/import-rules";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, TableMore, sp, type SP } from "@/components/ui";
import SaveDocument from "@/components/SaveDocument";
import { previewImportAction } from "./actions";

export const metadata = { title: "Bring in existing records" };
export const dynamic = "force-dynamic";

const Guide = ({ title, cols }: { title: string; cols: typeof ASSET_COLUMNS }) => (
  <details className="inline">
    <summary>{title}</summary>
    <div className="table-wrap"><table>
      <thead><tr><th>Column</th><th>Needed</th><th>What to write</th></tr></thead>
      <tbody>{cols.map((c) => <tr key={c.key}><td>{c.label}</td><td>{c.required ? "Yes" : "No"}</td><td className="small">{c.hint}</td></tr>)}</tbody>
    </table></div>
  </details>
);

export default async function ImportPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("import.manage");
  const batches = await listImports(member);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 4 }}>
        <h1>Bring in existing records</h1>
        <p className="small muted">Upload a spreadsheet saved as CSV. You see a preview first, with duplicates and mistakes marked, and nothing is created until you confirm. Import assets before the leases that refer to them.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>1. Get the template</h2>
        <div className="row">
          <SaveDocument url="/app/import/template/assets" fallbackName="import-assets-template.csv" label="Assets template" />
          <SaveDocument url="/app/import/template/leases" fallbackName="import-leases-template.csv" label="Leases template" />
        </div>
        <Guide title="Columns for assets" cols={ASSET_COLUMNS} />
        <Guide title="Columns for leases" cols={LEASE_COLUMNS} />
      </section>

      <section className="card stack">
        <h2>2. Upload</h2>
        <form action={previewImportAction} className="stack" encType="multipart/form-data">
          <div className="fields">
            <Field label="What are you importing?">
              <select name="kind" required defaultValue="ASSETS"><option value="ASSETS">Assets</option><option value="LEASES">Leases, with rent already paid</option></select>
            </Field>
            <Field label="CSV file" hint={`Up to ${MAX_IMPORT_ROWS} lines and 2 MB. In Excel or Sheets, choose Save as CSV.`}>
              <input name="file" type="file" accept=".csv,text/csv" required />
            </Field>
          </div>
          <div className="row"><button className="btn primary" type="submit">Show me the preview</button></div>
        </form>
      </section>

      <section className="card stack">
        <h2>Earlier imports</h2>
        {batches.length === 0 ? <p className="muted">None yet.</p> : (
          <TableMore
            limit={8} noun="earlier imports"
            head={<tr><th>Ref</th><th>What</th><th>File</th><th>Status</th><th>Started</th></tr>}
            rows={batches.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/app/import/${b.id}`} className="mono">{b.ref}</Link></td>
                <td>{humanize(b.kind)}</td>
                <td className="small">{b.fileName}</td>
                <td><Pill status={b.status} /></td>
                <td className="small">{formatDateTime(b.createdAt)}</td>
              </tr>
            ))}
          />
        )}
      </section>
    </div>
  );
}
