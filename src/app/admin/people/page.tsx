import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { findPeople } from "@/lib/services/account-moderation";
import { formatDate } from "@/lib/dates";
import { Flash, Pager, sp, type SP } from "@/components/ui";

export const metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default async function People({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const q = sp(searchParams, "q") ?? "";
  const statusParam = sp(searchParams, "status");
  const status = statusParam === "suspended" || statusParam === "removed" ? statusParam : "";
  const data = await findPeople(admin.id, { q, status, page: Number(sp(searchParams, "page") || 1) });
  const href = (p: number) => `/admin/people?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin">Administration</Link>
        <h1>People</h1>
        <p className="muted">Find any account to suspend it for shady activity, restore it, or remove it permanently. Companies are suspended from <Link href="/admin/companies">Companies</Link>; repeated wrong passwords are handled in <Link href="/admin/sign-in-locks">Sign-in locks</Link>.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form className="card row" method="get" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 240px" }}>Name, email or phone<input name="q" defaultValue={q} /></label>
        <label className="field">Show<select name="status" defaultValue={status}><option value="">Everyone</option><option value="suspended">Suspended</option><option value="removed">Removed</option></select></label>
        <button className="btn" type="submit">Search</button>
      </form>
      {data.rows.length === 0 ? <p className="muted">Nobody matches.</p> : (
        <ul className="card vp-list">
          {data.rows.map((u) => (
            <li key={u.id}>
              <Link href={`/admin/people/${u.id}`} style={{ minWidth: 0 }}><strong>{u.name}</strong><span className="small muted" style={{ overflowWrap: "anywhere" }}>{u.removedAt ? "Removed account" : u.email}{u.phone && !u.removedAt ? ` · ${u.phone}` : ""} · joined {formatDate(u.createdAt)}</span></Link>
              {u.removedAt ? <span className="pill bad">Removed</span> : u.suspendedAt ? <span className="pill warn">Suspended</span> : u.isPlatformAdmin ? <span className="pill">Administrator</span> : null}
            </li>
          ))}
        </ul>
      )}
      <Pager page={data.page} total={data.total} pageSize={data.size} href={href} noun="people" />
    </div>
  );
}
