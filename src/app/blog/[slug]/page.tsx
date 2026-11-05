import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/services/blog";
import { BLOG_CATEGORIES, parseBody } from "@/lib/blog-rules";
import { PLATFORM_NAME } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { RichBlocks } from "@/components/RichText";
import { BlogShare } from "@/components/BlogShare";
import { BlogCard, coverUrl } from "@/components/BlogCard";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await getPost((await params).slug).catch(() => null);
  if (!r) return { title: "Article not found", robots: { index: false } };
  const p = r.post;
  const url = `/blog/${p.slug}`;
  return {
    title: p.title, description: p.excerpt, keywords: p.tags,
    alternates: { canonical: url },
    authors: [{ name: p.authorName }],
    openGraph: { type: "article", siteName: PLATFORM_NAME, title: p.title, description: p.excerpt, url, publishedTime: p.publishedAt?.toISOString(), modifiedTime: p.updatedAt.toISOString(), authors: [p.authorName], section: BLOG_CATEGORIES[p.category as keyof typeof BLOG_CATEGORIES], tags: p.tags },
    twitter: { card: "summary_large_image", title: p.title, description: p.excerpt },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const r = await getPost((await params).slug).catch(() => null);
  if (!r) notFound();
  const { post: p, related, newer, older } = r;
  const blocks = parseBody(p.body);
  const toc = blocks.filter((b): b is Extract<typeof b, { t: "h2" }> => b.t === "h2");
  const cat = BLOG_CATEGORIES[p.category as keyof typeof BLOG_CATEGORIES] ?? "Housy";
  return (
    <article className="blog-post" itemScope itemType="https://schema.org/BlogPosting">
      <div className="blog-progress" aria-hidden="true" />
      <header className="blog-post-head">
        <nav className="small"><Link href="/blog">Blog</Link> › <Link href={`/blog?category=${p.category}`}>{cat}</Link></nav>
        <span className={`blog-cat c-${p.category}`}>{cat}</span>
        <h1 itemProp="headline">{p.title}</h1>
        <p className="blog-lede" itemProp="description">{p.excerpt}</p>
        <p className="small muted"><span itemProp="author">{p.authorName}</span> · <time dateTime={p.publishedAt?.toISOString()} itemProp="datePublished">{formatDate(p.publishedAt)}</time>{p.updatedAt.getTime() - (p.publishedAt?.getTime() ?? 0) > 864e5 ? <> · updated {formatDate(p.updatedAt)}</> : null} · {p.readingMinutes} min read</p>
        <BlogShare path={`/blog/${p.slug}`} title={p.title} excerpt={p.excerpt} />
      </header>
      {p.coverType ? <figure className="blog-cover"><img src={coverUrl(p)} alt={p.coverAlt} itemProp="image" /></figure> : null}
      <div className="blog-layout">
        {toc.length > 2 ? (
          <aside className="blog-toc" aria-label="In this article">
            <details open><summary>In this article</summary><ol>{toc.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>)}</ol></details>
          </aside>
        ) : null}
        <div className="blog-body" itemProp="articleBody"><RichBlocks blocks={blocks} /></div>
      </div>
      {p.tags.length ? <p className="blog-tags">{p.tags.map((t) => <Link key={t} href={`/blog?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}</p> : null}
      <section className="blog-end card">
        <div><strong>Found this useful?</strong><p className="small muted">Share it with someone who is house-hunting.</p></div>
        <BlogShare path={`/blog/${p.slug}`} title={p.title} excerpt={p.excerpt} />
      </section>
      {newer || older ? (
        <nav className="blog-pn" aria-label="More articles">
          {older ? <Link href={`/blog/${older.slug}`} className="card"><small className="muted">← Earlier</small><strong>{older.title}</strong></Link> : <span />}
          {newer ? <Link href={`/blog/${newer.slug}`} className="card" style={{ textAlign: "right" }}><small className="muted">Newer →</small><strong>{newer.title}</strong></Link> : <span />}
        </nav>
      ) : null}
      {related.length ? (
        <section className="stack">
          <h2>Keep reading</h2>
          <ul className="blog-grid">{related.map((x, i) => <li key={x.id}><BlogCard p={x} i={i} /></li>)}</ul>
        </section>
      ) : null}
      <section className="blog-cta">
        <div><h2>Ready to find your next home?</h2><p>Verified listings, safe inspections and agents you can trust.</p></div>
        <Link className="btn primary" href="/browse">Find property</Link>
      </section>
    </article>
  );
}
