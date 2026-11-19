import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { legalAdminList } from "@/lib/services/legal-pages";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { newLegalPageAction } from "./actions";

export const metadata = { title: "Legal pages" };
export const dynamic = "force-dynamic";

export default async function AdminLegalPage({ searchParams: spP }: { searchParams?: Promise<SP> }) {
  const searchParams = await spP;
  const a = await requirePlatformAdmin();
  const pages = await legalAdminList(a.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Legal pages</h1>
        <p className="muted">Write and publish the terms, privacy policy and other legal pages in your own words (have your lawyer check them). Each change is a new version; published versions are kept and stay readable. Until you publish a page, the built-in text is shown. <Link href="/admin">Back to admin</Link></p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack" aria-labelledby="pages-h">
        <h2 id="pages-h">Pages</h2>
        <ul className="stack" style={{ listStyle: "none", padding: 0, gap: 8 }}>{pages.map((p) => (
          <li key={p.slug} className="row wrap" style={{ justifyContent: "space-between", gap: 8, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            <span className="stack" style={{ gap: 2 }}>
              <strong>{p.title}</strong>
              <span className="small muted">/legal/{p.slug} · {p.published ? `version ${p.published.version}, published ${formatDate(p.published.publishedAt!)}${p.published.effectiveFrom ? `, in effect from ${formatDate(p.published.effectiveFrom)}` : ""}` : "built-in text (not yet written by you)"}{p.draft ? ` · draft of version ${p.draft.version} waiting` : ""}</span>
            </span>
            <span className="row" style={{ gap: 8 }}>
              <Link className="btn small" href={`/admin/legal/${p.slug}`}>{p.draft ? "Continue the draft" : "Write a new version"}</Link>
              <Link className="btn small" href={`/legal/${p.slug}`}>View</Link>
            </span>
          </li>
        ))}</ul>
      </section>
      <section className="card stack" aria-labelledby="new-h">
        <h2 id="new-h">Add a page</h2>
        <form action={newLegalPageAction} className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <Field label="Web address" hint="Lower-case letters, digits and dashes, such as refund-policy. The page appears at /legal/refund-policy."><input name="slug" required maxLength={41} pattern="[a-z][a-z0-9-]{1,40}" /></Field>
          <button className="btn" type="submit">Start writing</button>
        </form>
      </section>
    </div>
  );
}
