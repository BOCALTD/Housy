import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDate, formatDateTime, toDateOnlyString, todayInLagos } from "@/lib/dates";
import { parseBody } from "@/lib/blog-rules";
import { CONSENT_SLUGS, legalEditor } from "@/lib/services/legal-pages";
import { RichBlocks } from "@/components/RichText";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { discardLegalAction, saveLegalAction } from "../actions";

export const metadata = { title: "Write a legal page" };
export const dynamic = "force-dynamic";

export default async function LegalEditorPage({ params, searchParams: spP }: { params: Promise<{ slug: string }>; searchParams?: Promise<SP> }) {
  const searchParams = await spP;
  const a = await requirePlatformAdmin();
  const e = await legalEditor(a.id, (await params).slug).catch(() => null);
  if (!e) notFound();
  const consent = (CONSENT_SLUGS as readonly string[]).includes(e.slug);
  const start = e.start ?? { title: "", summary: "", body: "" };
  const draft = e.draft;
  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>{draft ? `Draft of version ${draft.version}` : e.current ? `New version of ${e.current.title}` : `Write ${start.title || e.slug}`}</h1>
        <p className="muted">/legal/{e.slug} · {e.current ? `version ${e.current.version} is published` : e.builtIn ? "the built-in text is shown until you publish" : "not published yet"}. <Link href="/admin/legal">All legal pages</Link></p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {!draft && e.start ? <p className="small muted">The text below starts from {e.current ? "the published version" : "the built-in text"}. Replace it with your own wording; nothing changes for visitors until you publish.</p> : null}
      <form action={saveLegalAction} className="card stack">
        <input type="hidden" name="slug" value={e.slug} />
        <Field label="Title"><input name="title" required maxLength={120} defaultValue={draft?.title ?? start.title} /></Field>
        <Field label="Summary" hint="One or two sentences shown under the title and on the list of legal pages."><input name="summary" maxLength={300} defaultValue={draft?.summary ?? start.summary} /></Field>
        <Field label="Text" hint="Write in plain text. ## starts a section heading, - starts a list item, **bold**, and [link text](https://address) for links. A blank line starts a new paragraph.">
          <textarea name="body" required rows={22} maxLength={100000} defaultValue={draft?.body ?? start.body} style={{ fontFamily: "var(--mono, monospace)", fontSize: 16 }} />
        </Field>
        <div className="grid-2">
          <Field label="What changed" hint={consent ? "Needed to publish the terms or the privacy policy. Shown at the top of the page." : "Shown at the top of the page."}><input name="changeNote" maxLength={300} defaultValue={draft?.changeNote ?? ""} /></Field>
          <Field label="Takes effect on (optional)" hint="Leave empty for straight away. Until then the current version stays in effect and the page links to the new one."><input name="effectiveFrom" type="date" min={toDateOnlyString(todayInLagos())} defaultValue={draft?.effectiveFrom ? toDateOnlyString(draft.effectiveFrom) : ""} /></Field>
        </div>
        {consent ? <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="material" defaultChecked={draft?.material ?? false} /><span>This is a material change: ask every signed-in person to agree again once it is in effect.</span></label> : null}
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" type="submit" name="intent" value="draft">Save draft</button>
          <button className="btn primary" type="submit" name="intent" value="publish" data-confirm="Publish this version?" data-confirm-body="It becomes the public page (on the date you set). Published versions cannot be edited; a later change is a new version." data-confirm-ok="Publish">Publish</button>
        </div>
      </form>
      {draft ? (
        <form action={discardLegalAction}><input type="hidden" name="slug" value={e.slug} /><button className="btn small" type="submit" data-confirm="Discard this draft?" data-confirm-body="The published version is not affected." data-confirm-ok="Discard">Discard the draft</button></form>
      ) : null}
      {draft ? (
        <details className="vp-fold card">
          <summary>Preview the saved draft</summary>
          <article className="blog-post legal"><h2>{draft.title}</h2>{draft.summary ? <p className="blog-lede">{draft.summary}</p> : null}<div className="blog-body"><RichBlocks blocks={parseBody(draft.body)} /></div></article>
        </details>
      ) : null}
      {e.versions.length ? (
        <section className="card stack" aria-labelledby="ver-h">
          <h2 id="ver-h">Versions</h2>
          <ul className="small" style={{ paddingLeft: 18 }}>{e.versions.map((v) => (
            <li key={v.id}>Version {v.version} · {v.status === "PUBLISHED" ? "published" : v.status === "RETIRED" ? "replaced" : "withdrawn before it took effect"} {v.publishedAt ? formatDateTime(v.publishedAt) : ""}{v.effectiveFrom ? `, in effect from ${formatDate(v.effectiveFrom)}` : ""}{v.material ? " · asked people to agree again" : ""}{v.changeNote ? ` · ${v.changeNote}` : ""} {v.status !== "WITHDRAWN" ? <Link href={`/legal/${e.slug}?version=${v.version}`}>View</Link> : null}</li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  );
}
