import Link from "next/link";
import { BLOG_CATEGORIES } from "@/lib/blog-rules";
import { formatDate } from "@/lib/dates";

export type BlogCardPost = { slug: string; title: string; excerpt: string; category: string; coverType: string | null; coverAlt: string; readingMinutes: number; publishedAt: Date | null; updatedAt: Date; authorName: string };

export const coverUrl = (p: { slug: string; updatedAt: Date }) => `/blog/${p.slug}/cover?v=${p.updatedAt.getTime()}`;
const EMOJI: Record<string, string> = { guides: "🗝️", safety: "🛡️", market: "📈", agents: "💼", flatmates: "🤝", living: "🛋️", news: "📣" };

/** A post on the blog's lists: cover thumbnail, category, title, description and reading time. */
export function BlogCard({ p, big = false, i = 0 }: { p: BlogCardPost; big?: boolean; i?: number }) {
  return (
    <Link href={`/blog/${p.slug}`} className={`blog-card${big ? " big" : ""}`} style={{ ["--i" as string]: i }}>
      <span className={`blog-thumb c-${p.category}`}>
        {p.coverType ? <img src={coverUrl(p)} alt={p.coverAlt} loading={big ? "eager" : "lazy"} /> : <span className="blog-thumb-emoji" aria-hidden="true">{EMOJI[p.category] ?? "🏠"}</span>}
      </span>
      <span className="blog-card-text">
        <span className={`blog-cat c-${p.category}`}>{BLOG_CATEGORIES[p.category as keyof typeof BLOG_CATEGORIES] ?? "Housy"}</span>
        <strong>{p.title}</strong>
        <span className="blog-excerpt">{p.excerpt}</span>
        <span className="small muted">{p.publishedAt ? formatDate(p.publishedAt) : "Draft"} · {p.readingMinutes} min read</span>
      </span>
    </Link>
  );
}
