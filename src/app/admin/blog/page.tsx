import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminPosts } from "@/lib/services/blog";
import { BLOG_CATEGORIES } from "@/lib/blog-rules";
import { formatDate } from "@/lib/dates";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { startersAction } from "./actions";

export const metadata = { title: "Blog" };
export const dynamic = "force-dynamic";

export default async function AdminBlog({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const a = await requirePlatformAdmin();
  const posts = await adminPosts(a.id);
  const live = posts.filter((p) => p.status === "PUBLISHED").length;
  return (
    <div className="stack-lg">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="stack" style={{ gap: 4 }}><h1>Blog</h1><p className="muted">{live} published · {posts.length - live} drafts. Published posts are public, in the sitemap and the RSS feed, and show a cover thumbnail when shared.</p></div>
        <div className="row"><Link className="btn" href="/blog">View the blog</Link><Link className="btn primary" href="/admin/blog/new">＋ New post</Link></div>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      {posts.length === 0 ? (
        <section className="card art-empty">
          <div className="art-empty-ico" aria-hidden="true">✍️</div><h2>No posts yet</h2>
          <p className="muted">Write your first article, or add Housy&apos;s four starter guides (inspections, fees, scams, flatmates) as drafts to review and publish.</p>
          <form action={startersAction}><button className="btn primary" type="submit">Add the starter guides</button></form>
        </section>
      ) : (
        <section className="card">
          <ShowMore limit={15} noun="posts" items={posts.map((p) => (
            <div key={p.id} className="cf-item">
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <Link href={`/admin/blog/${p.id}`}><strong>{p.title}</strong></Link>
                <span className="small muted">{BLOG_CATEGORIES[p.category as keyof typeof BLOG_CATEGORIES] ?? p.category} · {p.readingMinutes} min · {p.coverType ? "has cover" : "no cover yet"}{p.featured ? " · featured" : ""}</span>
              </div>
              <div className="cf-item-side"><Pill status={p.status === "PUBLISHED" ? "OK" : "DRAFT"} label={p.status === "PUBLISHED" ? "Published" : "Draft"} /><span className="small muted">{formatDate(p.publishedAt ?? p.updatedAt)}</span></div>
            </div>
          ))} />
          <form action={startersAction} style={{ marginTop: 12 }}><button className="btn" type="submit">Add any missing starter guides</button></form>
        </section>
      )}
    </div>
  );
}
