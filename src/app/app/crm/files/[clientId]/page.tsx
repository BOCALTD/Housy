import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { ROLES, SECTIONS, SHAREABLE, clientFile, folderItems, type Section } from "@/lib/services/client-files";
import { dealOptions } from "@/lib/services/deal";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { addPropertyAction, removePropertyAction, revokeLinkAction } from "../actions";
import { ShareForm } from "../ShareForm";

export const metadata = { title: "Client file" };
export const dynamic = "force-dynamic";

const ICONS: Record<Section, string> = { documents: "📄", correspondence: "✉️", inspections: "🧭", inventory: "📦", projects: "🛠️", valuations: "📈" };

export default async function ClientFilePage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams?: Promise<SP> }) {
  const { clientId } = await params;
  const s = await searchParams;
  const member = await requireMember("crm.view");
  const file = await clientFile(member, clientId).catch(() => null);
  if (!file) notFound();
  const manage = can(member.role, "crm.manage");
  const docs = can(member.role, "document.download");
  const open = sp(s, "open") ?? "";
  const [openAsset, openSection] = open.split(":") as [string, Section | undefined];
  const items = openAsset && openSection && openSection in SECTIONS && (openSection !== "documents" || docs)
    ? await folderItems(member, clientId, openAsset, openSection).catch(() => null) : null;
  const options = manage ? await dealOptions(member) : [];
  const inFile = new Set(file.groups.flatMap((g) => g.items.map((p) => p.id)));
  const shareable = SHAREABLE.filter((x) => x !== "documents" || docs);
  const { client: c } = file;
  const total = file.groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="stack-lg">
      <section className="cf-hero">
        <div>
          <p className="eyebrow"><Link href="/app/crm/files">Client files</Link> · {c.ref}</p>
          <h1>{c.name}</h1>
          <p className="muted">{humanize(c.kind)}{c.email ? ` · ${c.email}` : ""}{c.phone ? ` · ${c.phone}` : ""} · {total} {total === 1 ? "property" : "properties"} · <Link href={`/app/crm/clients/${c.id}`}>Client record</Link></p>
        </div>
        <div className="cf-hero-art" aria-hidden="true"><span /><span /><span /></div>
      </section>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />

      {manage ? (
        <details className="card cf-add">
          <summary><strong>＋ Add a property to this file</strong></summary>
          <form action={addPropertyAction} className="fields">
            <input type="hidden" name="clientId" value={c.id} />
            <Field label="Property"><select name="assetId" required defaultValue=""><option value="" disabled>Choose a property</option>{options.filter((a) => !inFile.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
            <Field label="The client is the"><select name="role" defaultValue="OWNER">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <button className="btn primary" type="submit">Add</button>
          </form>
        </details>
      ) : null}

      {file.groups.length === 0 ? (
        <section className="card art-empty"><div className="art-empty-ico" aria-hidden="true">🏠</div><h2>No properties in this file yet</h2><p className="muted">Add a property above. Properties from this client&apos;s deals are added on their own.</p></section>
      ) : file.groups.map((g) => (
        <section key={g.label} className="stack">
          <h2 className="cf-group"><span aria-hidden="true">📁</span> {humanize(g.label.split(" · ")[0])} <small>· {g.label.split(" · ")[1]}</small></h2>
          <ShowMore limit={4} noun="properties" items={g.items.map((p) => (
            <article key={p.id} className="card cf-prop">
              <header className="cf-prop-head">
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>{p.name}</strong>
                  <span className="small muted">{p.ref} · {ROLES[p.role as keyof typeof ROLES] ?? humanize(p.role)} · {humanize(p.status)}</span>
                </div>
                <Link className="btn" href={`/app/assets/${p.id}`}>Open property</Link>
              </header>
              <ul className="cf-tiles">
                {(Object.keys(SECTIONS) as Section[]).filter((k) => k !== "documents" || docs).map((k) => {
                  const on = openAsset === p.id && openSection === k;
                  return (
                    <li key={k}>
                      <Link scroll={false} className={`cf-tile t-${k}${on ? " on" : ""}`} href={on ? `/app/crm/files/${c.id}` : `/app/crm/files/${c.id}?open=${p.id}:${k}#p-${p.id}`} aria-expanded={on}>
                        <span aria-hidden="true">{ICONS[k]}</span><b>{p.counts[k]}</b><small>{SECTIONS[k]}</small>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {openAsset === p.id && items ? (
                <div className="cf-items" id={`p-${p.id}`}>
                  <h3>{SECTIONS[openSection!]}</h3>
                  {items.length === 0 ? <p className="muted small">Nothing here yet.</p> : (
                    <ShowMore limit={6} noun="items" items={items.map((it) => (
                      <div key={it.id} className="cf-item">
                        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                          {it.href ? <Link href={it.href}><strong>{it.title}</strong></Link> : <strong>{it.title}</strong>}
                          <span className="small muted">{it.detail}</span>
                        </div>
                        <div className="cf-item-side">{it.amount ? <b>{it.amount}</b> : null}{it.when ? <time className="small muted">{formatDate(it.when)}</time> : null}</div>
                      </div>
                    ))} />
                  )}
                </div>
              ) : null}
              {manage ? (
                <details className="inline cf-share">
                  <summary>🔗 Share with the client{p.links.length ? ` · ${p.links.length} open link${p.links.length === 1 ? "" : "s"}` : ""}</summary>
                  <ShareForm clientId={c.id} assetId={p.id} sections={shareable} email={c.email || undefined} phone={c.phone || undefined} />
                  {p.links.length ? (
                    <ul className="cf-links">{p.links.map((l) => (
                      <li key={l.id}>
                        <span className="small">{l.sections.map((x) => SECTIONS[x as Section] ?? x).join(", ")} · until {formatDate(l.expiresAt)} · opened {l.views} time{l.views === 1 ? "" : "s"}{l.lastViewedAt ? `, last ${formatDate(l.lastViewedAt)}` : ""}</span>
                        <form action={revokeLinkAction}><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="linkId" value={l.id} /><button className="btn" type="submit">Close link</button></form>
                      </li>
                    ))}</ul>
                  ) : null}
                  <form action={removePropertyAction}><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="assetId" value={p.id} /><button className="btn" type="submit" data-confirm="Remove this property from the client&#x27;s file?" data-confirm-body="The client no longer sees it in their file." data-confirm-ok="Remove">Remove from this file</button></form>
                </details>
              ) : null}
            </article>
          ))} />
        </section>
      ))}
    </div>
  );
}
