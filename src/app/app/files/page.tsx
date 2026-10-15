import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { expiringDocuments, fileMovements, listPhysicalFiles } from "@/lib/services/files";
import { listDepartments } from "@/lib/services/settings";
import { listAssets } from "@/lib/services/assets";
import { listTeam } from "@/lib/services/companies";
import { formatDate, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, ShowMore, TableMore, sp, type SP } from "@/components/ui";
import { createFileAction, issueFileAction, returnFileAction } from "./actions";

export const metadata = { title: "Files and deadlines" };

export default async function FilesPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const view = sp(searchParams, "view") ?? "";
  const q = sp(searchParams, "q") ?? "";
  const show = sp(searchParams, "file");
  const manage = can(member.role, "file.manage");
  const [files, expiring, departments, assets, team] = await Promise.all([
    listPhysicalFiles(member, { q, view }),
    expiringDocuments(member, 60),
    manage ? listDepartments(member) : Promise.resolve([]),
    manage ? listAssets(member) : Promise.resolve([]),
    manage ? listTeam(member) : Promise.resolve(null),
  ]);
  const history = show ? await fileMovements(member, show) : null;
  const today = todayInLagos();
  const inTwoWeeks = toDateOnlyString(new Date(today.getTime() + 14 * 864e5));
  const members = team?.members.filter((m) => m.status === "ACTIVE") ?? [];

  return (
    <div className="stack-lg">
      <h1>Files and deadlines</h1>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card" aria-labelledby="exp-h">
        <div className="section-head">
          <h2 id="exp-h">Documents expiring in the next 60 days</h2>
          <span className="small muted">Leases, permits, insurance and other dated documents</span>
        </div>
        {expiring.length === 0 ? <p className="muted">No documents expire in the next 60 days.</p> : (
          <div className="table-wrap">
            <TableMore limit={12} noun="more rows" head={<tr><th>Document</th><th>Asset</th><th>Expires</th><th></th></tr>} rows={expiring.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}<div className="small muted">{humanize(d.category)}</div></td>
                    <td><Link href={`/app/assets/${d.asset.id}`}>{d.asset.ref} · {d.asset.name}</Link></td>
                    <td>{formatDate(d.expiresOn)}</td>
                    <td>{d.expiresOn && d.expiresOn < today ? <Pill status="OVERDUE" label="Expired" /> : <Pill status="DUE" label="Expiring" />}</td>
                  </tr>
                ))} />
          </div>
        )}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Physical file register</h2>
          <nav className="nav" aria-label="File views">
            <Link href="/app/files" aria-current={!view ? "page" : undefined}>All</Link>
            <Link href="/app/files?view=issued" aria-current={view === "issued" ? "page" : undefined}>Out of the registry</Link>
            <Link href="/app/files?view=overdue" aria-current={view === "overdue" ? "page" : undefined}>Overdue returns</Link>
          </nav>
        </div>
        <form className="row" role="search">
          {view ? <input type="hidden" name="view" value={view} /> : null}
          <input name="q" id="fq" defaultValue={q} placeholder="File number or title" aria-label="Search files"
                 style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: "var(--surface)" }} />
          <button className="btn" type="submit">Search</button>
        </form>
        <div className="card table-wrap" style={{ padding: 0 }}>
          {files.length === 0 ? <p className="muted" style={{ padding: 20 }}>{q || view ? "No files match." : "No physical files registered yet."}</p> : (
            <TableMore limit={12} noun="more rows" head={<tr><th>File no.</th><th>Title</th><th>Where it is</th><th>Status</th><th></th></tr>} rows={files.map((f) => (
                  <tr key={f.id}>
                    <td className="mono"><Link href={`/app/files?file=${f.id}`}>{f.fileNumber}</Link></td>
                    <td>{f.title}<div className="small muted">{[f.department?.code, f.asset?.ref].filter(Boolean).join(" · ")}</div></td>
                    <td className="small">
                      {f.status === "ISSUED" && f.holder ? <>With {f.holder.user.name}{f.open ? <>, due back {formatDate(f.open.expectedReturnOn)}</> : null}</> : f.location || "Registry"}
                    </td>
                    <td>{f.overdue ? <Pill status="OVERDUE" label="Overdue" /> : <Pill status={f.status === "ISSUED" ? "IN_PROGRESS" : "ACTIVE"} label={f.status === "ISSUED" ? "Issued" : "In registry"} />}</td>
                    <td>
                      {manage && f.status === "IN_REGISTRY" ? (
                        <details className="inline">
                          <summary className="small">Issue</summary>
                          <form action={issueFileAction} className="stack" style={{ flex: "1 1 220px", minWidth: 0 }}>
                            <input type="hidden" name="fileId" value={f.id} />
                            <Field label="To"><select name="holderId" required defaultValue="">
                              <option value="" disabled>Choose</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}
                            </select></Field>
                            <Field label="Return by"><input name="expectedReturnOn" type="date" required defaultValue={inTwoWeeks} min={toDateOnlyString(today)} /></Field>
                            <Field label="Purpose"><input name="purpose" /></Field>
                            <button className="btn primary small" type="submit">Issue file</button>
                          </form>
                        </details>
                      ) : null}
                      {manage && f.status === "ISSUED" ? (
                        <form action={returnFileAction}><input type="hidden" name="fileId" value={f.id} /><button className="btn small" type="submit">Record return</button></form>
                      ) : null}
                    </td>
                  </tr>
                ))} />
          )}
        </div>
      </section>

      {history ? (
        <section className="card">
          <h2>Movement history</h2>
          {history.length === 0 ? <p className="muted">This file has not left the registry.</p> : (
            <ShowMore noun="more" limit={5} items={history.map((m) => (
                <li key={m.id}><div>
                  Issued to {m.holderName} on {formatDate(m.issuedOn)}, due {formatDate(m.expectedReturnOn)}
                  <div className="small muted">{m.returnedOn ? `Returned ${formatDate(m.returnedOn)}${m.returnedOn > m.expectedReturnOn ? " (late)" : ""}` : "Not yet returned"}{m.purpose ? ` · ${m.purpose}` : ""}</div>
                </div></li>
              ))} />
          )}
        </section>
      ) : null}

      {manage ? (
        <section className="card" style={{ maxWidth: 760 }}>
          <h2>Add a file to the register</h2>
          <form action={createFileAction} className="stack">
            <div className="fields">
              <Field label="File number"><input name="fileNumber" id="fileNumber" required placeholder="F-0001" /></Field>
              <Field label="Title"><input name="title" id="ftitle" required /></Field>
            </div>
            <div className="fields">
              <Field label="Shelf or cabinet"><input name="location" id="location" /></Field>
              <Field label="Department"><select name="departmentId" id="fdept" defaultValue=""><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <Field label="Asset"><select name="assetId" id="fasset" defaultValue=""><option value="">None</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
            </div>
            <div className="row"><button className="btn primary" type="submit">Add file</button></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
