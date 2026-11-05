import { listPosts } from "@/lib/services/blog";
import { siteOrigin } from "@/lib/origin";
import { PLATFORM_NAME } from "@/lib/labels";

export const revalidate = 600;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The blog as an RSS feed, for readers and for sites that pick up new articles. */
export async function GET() {
  const base = await siteOrigin();
  const { rows, featured } = await listPosts({ page: 0 }).catch(() => ({ rows: [], featured: null }));
  const posts = [...(featured ? [featured] : []), ...rows].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const items = posts.map((p) => `<item><title>${esc(p.title)}</title><link>${base}/blog/${p.slug}</link><guid isPermaLink="true">${base}/blog/${p.slug}</guid><description>${esc(p.excerpt)}</description>${p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : ""}${p.coverType ? `<enclosure url="${base}/blog/${p.slug}/cover" type="${p.coverType}" length="0"/>` : ""}</item>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(PLATFORM_NAME)} blog</title><link>${base}/blog</link><description>Property guides from the ${esc(PLATFORM_NAME)} team</description><language>en-ng</language>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" } });
}
