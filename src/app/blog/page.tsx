import type { Metadata } from "next";
import Link from "next/link";
import { listPosts } from "@/lib/services/blog";
import { BLOG_CATEGORIES, BLOG_PAGE } from "@/lib/blog-rules";
import { PLATFORM_NAME } from "@/lib/labels";
import { Pager, sp, type SP } from "@/components/ui";
import { BlogCard } from "@/components/BlogCard";

export const revalidate = 300;

export async function generateMetadata({ searchParams }: { searchParams?: Promise<SP> }): Promise<Metadata> {
  const s = await searchParams;
  const cat = sp(s, "category") ?? "";
  const label = BLOG_CATEGORIES[cat as keyof typeof BLOG_CATEGORIES];
  const title = label ? `${label} · Blog` : "Blog and guides";
  const description = "Guides to renting, buying and selling property in Nigeria, staying safe from scams, market prices, flatmates and running a property business, from the Housy team.";
  return {
    title, description,
    alternates: { canonical: label ? `/blog?category=${cat}` : "/blog", types: { "application/rss+xml": "/blog/feed.xml" } },
    openGraph: { type: "website", siteName: PLATFORM_NAME, title: `${title} · ${PLATFORM_NAME}`, description, url: "/blog" },
    twitter: { card: "summary_large_image", title, description },
    robots: sp(s, "q") ? { index: false, follow: true } : undefined,
  };
}

export default async function BlogPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const category = sp(s, "category") ?? "";
  const tag = sp(s, "tag") ?? "";
  const q = sp(s, "q") ?? "";
  const page = Math.max(0, Number(sp(s, "page") ?? 0) || 0);
  const r = await listPosts({ category, tag, q, page }).catch(() => ({ rows: [], featured: null, total: 0, page, counts: {} as Record<string, number> }));
  const href = (over: Record<string, string>) => `/blog?${new URLSearchParams({ ...(category ? { category } : {}), ...(tag ? { tag } : {}), ...(q ? { q } : {}), ...over })}`;
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  return (
    <div className="stack-lg blog">
      <section className="blog-hero">
        <div className="blog-hero-orbs" aria-hidden="true"><i /><i /><i /></div>
        <p className="eyebrow">The Housy blog</p>
        <h1>Smart moves in property, <em className="hl">made simple</em></h1>
        <p>Guides to renting and buying, staying safe, prices in your area, flatmates and running a property business.</p>
        <form method="get" action="/blog" role="search" className="blog-search">
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <input name="q" type="search" defaultValue={q} placeholder="Search articles" aria-label="Search articles" />
          <button className="btn primary" type="submit">Search</button>
        </form>
      </section>

      <nav className="blog-cats" aria-label="Categories">
        <Link href="/blog" className={!category ? "on" : ""}>All <b>{total}</b></Link>
        {Object.entries(BLOG_CATEGORIES).filter(([k]) => r.counts[k]).map(([k, v]) => <Link key={k} href={`/blog?category=${k}`} className={`c-${k}${category === k ? " on" : ""}`}>{v} <b>{r.counts[k]}</b></Link>)}
      </nav>
      {tag || q ? <p className="muted">{q ? <>Results for “{q}”</> : <>Tagged “{tag}”</>} · {r.total} found · <Link href={category ? `/blog?category=${category}` : "/blog"}>Clear</Link></p> : null}

      {r.featured ? <BlogCard p={r.featured} big /> : null}
      {r.rows.length === 0 && !r.featured ? (
        <section className="card art-empty"><div className="art-empty-ico" aria-hidden="true">📰</div><h2>{q || tag || category ? "No articles match" : "Articles are on the way"}</h2><p className="muted">{q || tag || category ? "Try another word or category." : "The Housy team is writing guides on renting, buying and staying safe. Meanwhile, see how Housy works."}</p><Link className="btn primary" href={q || tag || category ? "/blog" : "/how-it-works"}>{q || tag || category ? "All articles" : "How it works"}</Link></section>
      ) : (
        <ul className="blog-grid">{r.rows.map((p, i) => <li key={p.id}><BlogCard p={p} i={i} /></li>)}</ul>
      )}
      <Pager page={page} total={r.total} pageSize={BLOG_PAGE} href={(p) => href({ page: String(p) })} noun="articles" />
    </div>
  );
}
