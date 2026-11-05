import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { clientDirectory } from "@/lib/services/client-files";
import { humanize } from "@/lib/labels";
import { Pager, sp, type SP } from "@/components/ui";

export const metadata = { title: "Client files" };
export const dynamic = "force-dynamic";
const PAGE = 24;

export default async function ClientFilesPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const member = await requireMember("crm.view");
  const q = sp(s, "q") ?? "";
  const page = Math.max(0, Number(sp(s, "page") ?? 0) || 0);
  const all = await clientDirectory(member, q);
  const rows = all.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <div className="stack-lg">
      <section className="cf-hero">
        <div>
          <p className="eyebrow">Client files</p>
          <h1>Every client, every property, every paper</h1>
          <p className="muted">Each client&apos;s properties sorted by type and place, with documents, correspondence, field work, inventory, project costs and valuations under each one. Send a client a private link to follow their property.</p>
        </div>
        <div className="cf-hero-art" aria-hidden="true"><span /><span /><span /></div>
      </section>
      <form method="get" className="row" role="search">
        <input name="q" type="search" defaultValue={q} placeholder="Search clients by name, reference or email" aria-label="Search clients" style={{ flex: 1, minWidth: 0 }} />
        <button className="btn primary" type="submit">Search</button>
      </form>
      {rows.length === 0 ? (
        <section className="card art-empty"><div className="art-empty-ico" aria-hidden="true">🗂️</div><h2>No clients yet</h2><p className="muted">Add clients under Clients, then their properties appear here when you add them or a deal starts.</p><Link className="btn primary" href="/app/crm/clients">Go to clients</Link></section>
      ) : (
        <ul className="cf-grid">
          {rows.map((c, i) => (
            <li key={c.id} style={{ ["--i" as string]: i }}>
              <Link href={`/app/crm/files/${c.id}`} className="cf-client">
                <span className="cf-folder" aria-hidden="true"><b>{c.name.slice(0, 1).toUpperCase()}</b></span>
                <span className="cf-client-text"><strong>{c.name}</strong><span className="small muted">{c.ref} · {humanize(c.kind)}</span></span>
                <span className="cf-count">{c.properties}<small>{c.properties === 1 ? "property" : "properties"}</small></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={all.length} pageSize={PAGE} href={(p) => `/app/crm/files?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} noun="clients" />
    </div>
  );
}
