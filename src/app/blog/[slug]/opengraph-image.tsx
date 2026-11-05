import { getPost, postCover } from "@/lib/services/blog";
import { BLOG_CATEGORIES } from "@/lib/blog-rules";
import { CARD_SIZE, shareCard } from "@/lib/share-card";

// The link-preview picture for a shared article: its cover, category, title and reading time.
export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "A Housy blog article";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const r = await getPost(slug).catch(() => null);
  if (!r) return shareCard({ eyebrow: "Blog", title: "Guides from the Housy team", lines: [], cta: "Read on Housy" });
  const c = await postCover(slug).catch(() => null);
  const photo = c && (c.type === "image/jpeg" || c.type === "image/png") && c.bytes.length < 3_000_000 ? `data:${c.type};base64,${Buffer.from(c.bytes).toString("base64")}` : null;
  const p = r.post;
  return shareCard({ photo, eyebrow: BLOG_CATEGORIES[p.category as keyof typeof BLOG_CATEGORIES] ?? "Blog", title: p.title, lines: [p.excerpt.length > 110 ? `${p.excerpt.slice(0, 108).trimEnd()}…` : p.excerpt, `${p.readingMinutes} min read`], cta: "Read the article" });
}
