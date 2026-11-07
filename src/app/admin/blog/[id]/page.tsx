import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminPost } from "@/lib/services/blog";
import { BLOG_CATEGORIES, MAX_COVER_BYTES } from "@/lib/blog-rules";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { RichText } from "@/components/RichText";
import { deletePostAction, savePostAction, unpublishAction } from "../actions";

export const metadata = { title: "Edit post" };
export const dynamic = "force-dynamic";

export default async function EditPost({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const { id } = await params;
  const s = await searchParams;
  const a = await requirePlatformAdmin();
  const isNew = id === "new";
  const p = isNew ? null : await adminPost(a.id, id);
  if (!isNew && !p) notFound();
  return (
    <div className="stack-lg">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="stack" style={{ gap: 4 }}>
          <p className="small"><Link href="/admin/blog">Blog</Link></p>
          <h1>{isNew ? "New post" : p!.title}</h1>
          {p ? <p className="muted">{p.status === "PUBLISHED" ? <>Live at <Link href={`/blog/${p.slug}`}>/blog/{p.slug}</Link></> : "Draft: only administrators can see it."}</p> : null}
        </div>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <form action={savePostAction} className="card stack">
        <input type="hidden" name="id" value={p?.id ?? ""} />
        <Field label="Title"><input name="title" required minLength={8} maxLength={140} defaultValue={p?.title ?? ""} /></Field>
        <Field label="Description" hint="40 to 300 characters. Shown on the blog, on Google and in link previews."><textarea name="excerpt" rows={2} required minLength={40} maxLength={300} defaultValue={p?.excerpt ?? ""} /></Field>
        <div className="fields">
          <Field label="Category"><select name="category" required defaultValue={p?.category ?? ""}><option value="" disabled>Choose</option>{Object.entries(BLOG_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Tags" hint="Comma separated, up to 8"><input name="tags" defaultValue={p?.tags.join(", ") ?? ""} maxLength={400} /></Field>
          <Field label="Web address" hint="Leave empty to make it from the title"><input name="slug" defaultValue={p?.slug ?? ""} maxLength={80} pattern="[a-z0-9\-]*" /></Field>
        </div>
        <div className="fields">
          <Field label={p?.coverType ? "Replace the cover picture" : "Cover picture"} hint={`JPEG, PNG or WebP, up to ${MAX_COVER_BYTES / 1024 / 1024} MB. Wide pictures (1200 × 630) look best when shared.`}><input type="file" name="cover" accept="image/jpeg,image/png,image/webp" /></Field>
          <Field label="Describe the cover" hint="For people using screen readers"><input name="coverAlt" maxLength={200} defaultValue={p?.coverAlt ?? ""} /></Field>
        </div>
        {p?.coverType ? <img src={`/admin/blog/${p.id}/cover?v=${p.updatedAt.getTime()}`} alt={p.coverAlt} className="blog-admin-cover" /> : null}
        <Field label="Article" hint="Blank line between paragraphs. ## Heading, ### Smaller heading, - list, 1. numbered list, > quote, **bold**, *italic*, [link text](/path or https://…)"><textarea name="body" rows={22} required minLength={200} defaultValue={p?.body ?? ""} className="blog-editor" /></Field>
        <label className="check"><input type="checkbox" name="featured" defaultChecked={p?.featured ?? false} /> Feature at the top of the blog</label>
        <div className="row">
          <button className="btn" type="submit" name="intent" value="draft">Save draft</button>
          <button className="btn primary" type="submit" name="intent" value="publish">{p?.status === "PUBLISHED" ? "Update the live post" : "Publish"}</button>
        </div>
      </form>
      {p ? (
        <>
          <details className="card"><summary><strong>Preview</strong></summary><div className="blog-body" style={{ marginTop: 12 }}><RichText body={p.body} /></div></details>
          <section className="card stack">
            <h2>Remove</h2>
            {p.status === "PUBLISHED" ? <form action={unpublishAction}><input type="hidden" name="id" value={p.id} /><button className="btn" type="submit">Take off the blog (keep as draft)</button></form> : null}
            <form action={deletePostAction} className="row"><input type="hidden" name="id" value={p.id} /><label className="check"><input type="checkbox" name="confirm" /> I want to delete this post for good</label><button className="btn danger" type="submit" data-confirm="Delete this post for good?" data-confirm-body="It comes off the blog and cannot be brought back." data-confirm-ok="Delete post">Delete</button></form>
          </section>
        </>
      ) : null}
    </div>
  );
}
