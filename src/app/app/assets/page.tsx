import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { assetPage, ASSET_STATUSES } from "@/lib/services/assets";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Flash, Pager, Pill, sp, type SP } from "@/components/ui";

export const metadata = { title: "Assets" };

export default async function AssetsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const q = sp(searchParams, "q") ?? "";
  const status = sp(searchParams, "status") ?? "";
  const page = Math.max(0, Number.parseInt(sp(searchParams, "page") ?? "0", 10) || 0);
  const { rows: assets, total, pageSize, page: at } = await assetPage(member, { q, status, page });
  const href = (p: number) => `/app/assets?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <div className="stack">
      <div className="row between">
        <h1>Asset register</h1>
        {can(member.role, "asset.create") ? <Link className="btn primary" href="/app/assets/new">Register an asset</Link> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form className="row" role="search">
        <input name="q" id="q" defaultValue={q} placeholder="Name, reference or city" aria-label="Search assets"
               style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: "var(--surface)" }} />
        <select name="status" id="status" defaultValue={status} aria-label="Status"
                style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: "var(--surface)" }}>
          <option value="">All statuses</option>
          <EnumOptions values={ASSET_STATUSES} />
        </select>
        <button className="btn" type="submit">Filter</button>
      </form>
      <div className="card table-wrap" style={{ padding: 0 }}>
        {assets.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>
            {q || status ? "No assets match those filters." : "No assets yet. Register your first property, land parcel or equipment."}
          </p>
        ) : (
          <><div className="table-wrap"><table><thead><tr><th>Ref</th><th>Asset</th><th>Class</th><th>Location</th><th>Held as</th><th>Status</th><th>Listing</th></tr></thead><tbody>{assets.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.ref}</td>
                  <td><Link href={`/app/assets/${a.id}`}>{a.name}</Link><div className="small muted">{a.category}</div></td>
                  <td>{humanize(a.assetClass)}</td>
                  <td>{[a.city, a.state].filter(Boolean).join(", ") || "—"}</td>
                  <td>{humanize(a.companyRelationship)}</td>
                  <td><Pill status={a.status} /></td>
                  <td>{a.listing ? <Pill status={a.listing.status} /> : <span className="muted small">Internal only</span>}</td>
                </tr>
              ))}</tbody></table></div><Pager page={at} total={total} pageSize={pageSize} href={href} noun="assets" /></>
        )}
      </div>
    </div>
  );
}
