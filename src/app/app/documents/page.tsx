import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { formatDate, todayInLagos } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { readSort, withParams } from "@/lib/list-sort";
import { DOC_SORTS, FILE_TYPES, SOURCES, documentLibrary, fileType, type Source } from "@/lib/services/document-library";
import { ListTools, SortTh } from "@/components/ListTools";
import { Flash, Pager, sp, type SP } from "@/components/ui";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const PAGE = 25;
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default async function DocumentsPage({ searchParams: spP }: { searchParams?: Promise<SP> }) {
  const params = await spP;
  const member = await requireMember();
  const sort = readSort(params, DOC_SORTS);
  const q = sp(params, "q") ?? "";
  const source = sp(params, "source") ?? "";
  const type = sp(params, "type") ?? "";
  const { docs, capped, available } = await documentLibrary(member, { q, source, type, sort });
  const page = Math.max(0, Math.min(Number(sp(params, "page") ?? 0) || 0, Math.floor(Math.max(0, docs.length - 1) / PAGE)));
  const shown = docs.slice(page * PAGE, page * PAGE + PAGE);
  const today = todayInLagos();
  const path = "/app/documents";
  const th = (k: string, label: string, dir: "asc" | "desc" = "asc", cls?: string) => <SortTh path={path} params={params} sort={sort} k={k} dir={dir} className={cls}>{label}</SortTh>;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Documents</h1>
        <p className="muted">Every document your company holds, in one place: property documents, letters and emails, deals, projects and valuations. You see the ones you may open. <Link href="/app/files">Physical files and expiring documents</Link></p>
      </div>
      <Flash searchParams={{ error: sp(params, "error"), notice: sp(params, "notice") }} />
      <ListTools path={path} params={params} q={q} label="Search documents" placeholder="Title, file name, property, client or reference" options={DOC_SORTS} sort={sort} keep={[]}>
        <select name="source" defaultValue={source} aria-label="Where it belongs">
          <option value="">Everywhere</option>
          {available.map((s) => <option key={s} value={s}>{SOURCES[s]}</option>)}
        </select>
        <select name="type" defaultValue={type} aria-label="File type">
          <option value="">Any file type</option>
          {Object.entries(FILE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </ListTools>
      {available.length === 0 ? <p className="muted">Your role does not include documents.</p> : docs.length === 0 ? (
        <div className="card stack"><p>{q || source || type ? "No documents match. Try fewer words, or another place or file type." : "No documents yet. Upload them on a property, a letter, a deal, a project or a valuation."}</p>{q || source || type ? <p><Link className="btn" href={path}>Show all documents</Link></p> : null}</div>
      ) : (
        <section className="card stack" aria-label="Documents">
          <p className="small muted" role="status">{docs.length} document{docs.length === 1 ? "" : "s"}{q ? ` matching "${q}"` : ""}{capped ? ". Some places have more than can be listed: search to narrow it down." : ""}</p>
          <div className="table-wrap">
            <table className="stack-table">
              <thead><tr>{th("name", "Document")}{th("source", "Belongs to")}{th("date", "Added", "desc")}{th("size", "Size", "desc", "r")}{th("expires", "Expires")}</tr></thead>
              <tbody>{shown.map((d) => {
                const ft = fileType(d.mimeType, d.fileName);
                return (
                  <tr key={`${d.source}:${d.id}`}>
                    <td data-label="Document">
                      <a href={d.href} className="break"><strong>{d.title || d.fileName}</strong></a>
                      <div className="small muted break">{FILE_TYPES[ft]} · {d.fileName}</div>
                    </td>
                    <td data-label="Belongs to"><span className="small muted">{SOURCES[d.source as Source]} · {humanize(d.kind)}</span><br /><Link href={d.on.href} className="break">{d.on.label}</Link></td>
                    <td data-label="Added">{formatDate(d.createdAt)}</td>
                    <td data-label="Size" className="r">{size(d.sizeBytes)}</td>
                    <td data-label="Expires">{d.expiresOn ? <span className={d.expiresOn < today ? "pill bad" : ""}>{formatDate(d.expiresOn)}</span> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <Pager page={page} total={docs.length} pageSize={PAGE} noun="documents" href={(n) => withParams(path, params, { page: n || undefined })} />
        </section>
      )}
    </div>
  );
}
