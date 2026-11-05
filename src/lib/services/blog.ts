import { z } from "zod";
import { withPlatformAdmin, withPublic } from "../db";
import { logActivity } from "../audit";
import { BLOG_CATEGORIES, BLOG_PAGE, COVER_TYPES, MAX_COVER_BYTES, cleanTags, readingMinutes, slugify } from "../blog-rules";
import { STARTER_POSTS } from "../blog-starters";

/** The Housy blog: published posts for everyone; the platform administrator writes, publishes and adds covers. */

const card = { id: true, slug: true, title: true, excerpt: true, category: true, tags: true, featured: true, authorName: true, coverType: true, coverAlt: true, readingMinutes: true, publishedAt: true, updatedAt: true } as const;

export async function listPosts(opts: { category?: string; tag?: string; q?: string; page?: number } = {}) {
  const page = Math.max(0, opts.page ?? 0);
  const q = (opts.q ?? "").trim().slice(0, 80);
  const where = {
    status: "PUBLISHED",
    ...(opts.category && opts.category in BLOG_CATEGORIES ? { category: opts.category } : {}),
    ...(opts.tag ? { tags: { has: opts.tag.toLowerCase().slice(0, 30) } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { excerpt: { contains: q, mode: "insensitive" as const } }, { body: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  return withPublic(async (tx) => {
    const [rows, total, featured] = await Promise.all([
      tx.blogPost.findMany({ where, orderBy: { publishedAt: "desc" }, skip: page * BLOG_PAGE, take: BLOG_PAGE, select: card }),
      tx.blogPost.count({ where }),
      page === 0 && !opts.category && !opts.tag && !q ? tx.blogPost.findFirst({ where: { status: "PUBLISHED", featured: true }, orderBy: { publishedAt: "desc" }, select: card }) : null,
    ]);
    const counts = await tx.blogPost.groupBy({ by: ["category"], where: { status: "PUBLISHED" }, _count: { _all: true } });
    return { rows: featured ? rows.filter((r) => r.id !== featured.id) : rows, featured, total, page, counts: Object.fromEntries(counts.map((c) => [c.category, c._count._all])) as Record<string, number> };
  });
}

export async function getPost(slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return withPublic(async (tx) => {
    const post = await tx.blogPost.findFirst({ where: { slug, status: "PUBLISHED" }, select: { ...card, body: true } });
    if (!post) return null;
    const related = await tx.blogPost.findMany({
      where: { status: "PUBLISHED", id: { not: post.id }, OR: [{ category: post.category }, { tags: { hasSome: post.tags.length ? post.tags : ["-"] } }] },
      orderBy: { publishedAt: "desc" }, take: 3, select: card,
    });
    const [newer, older] = await Promise.all([
      tx.blogPost.findFirst({ where: { status: "PUBLISHED", publishedAt: { gt: post.publishedAt ?? new Date(0) } }, orderBy: { publishedAt: "asc" }, select: { slug: true, title: true } }),
      tx.blogPost.findFirst({ where: { status: "PUBLISHED", publishedAt: { lt: post.publishedAt ?? new Date() } }, orderBy: { publishedAt: "desc" }, select: { slug: true, title: true } }),
    ]);
    return { post, related, newer, older };
  });
}

/** A published post's cover picture. */
export async function postCover(slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return withPublic(async (tx) => {
    const p = await tx.blogPost.findFirst({ where: { slug, status: "PUBLISHED" }, select: { coverType: true, updatedAt: true, cover: { select: { bytes: true } } } });
    return p?.cover && p.coverType ? { bytes: p.cover.bytes, type: p.coverType, updatedAt: p.updatedAt } : null;
  });
}

/** For the sitemap. */
export async function publishedSlugs() {
  return withPublic((tx) => tx.blogPost.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" }, take: 5000 }));
}

// ---- Writing (platform administrator) ----

export async function adminPosts(adminId: string) {
  return withPlatformAdmin(adminId, (tx) => tx.blogPost.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 300, select: { ...card, status: true } }));
}

export async function adminPost(adminId: string, id: string) {
  return withPlatformAdmin(adminId, (tx) => tx.blogPost.findUnique({ where: { id }, select: { ...card, status: true, body: true } }));
}

/** A draft's cover, for the administrator's preview. */
export async function adminCover(adminId: string, id: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.blogPost.findUnique({ where: { id }, select: { coverType: true, cover: { select: { bytes: true } } } });
    return p?.cover && p.coverType ? { bytes: p.cover.bytes, type: p.coverType } : null;
  });
}

const postSchema = z.object({
  title: z.string().trim().min(8, { error: "Give the post a title of at least 8 characters" }).max(140),
  slug: z.string().trim().max(80).optional(),
  excerpt: z.string().trim().min(40, { error: "Write a description of at least 40 characters: it shows on Google and in link previews" }).max(300),
  body: z.string().trim().min(200, { error: "The article needs at least 200 characters" }).max(60_000),
  category: z.enum(Object.keys(BLOG_CATEGORIES) as [string, ...string[]], { error: "Choose a category" }),
  tags: z.string().max(400).default(""),
  coverAlt: z.string().trim().max(200).default(""),
  featured: z.boolean().default(false),
  publish: z.boolean().default(false),
});

/** Save a post (new when no id). The cover, when given, replaces the old one. */
export async function savePost(adminId: string, authorName: string, id: string | null, input: z.input<typeof postSchema>, cover?: { type: string; bytes: Uint8Array } | null) {
  const d = postSchema.parse(input);
  if (cover) {
    if (!(COVER_TYPES as readonly string[]).includes(cover.type)) throw new Error("The cover must be a JPEG, PNG or WebP picture");
    if (cover.bytes.byteLength > MAX_COVER_BYTES) throw new Error("The cover is over 2 MB. Use a smaller picture");
    // The file must really be the picture type it claims (checked from its first bytes, not from its name or the browser's word).
    const MAGIC: Record<string, number[]> = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] };
    const m = MAGIC[cover.type];
    if (!m || !m.every((x, i) => cover.bytes[i] === x) || (cover.type === "image/webp" && String.fromCharCode(...cover.bytes.slice(8, 12)) !== "WEBP")) throw new Error("The cover is not the picture type it claims to be");
  }
  const slug = slugify(d.slug || d.title);
  return withPlatformAdmin(adminId, async (tx) => {
    const clash = await tx.blogPost.findFirst({ where: { slug, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (clash) throw new Error("Another post already uses that web address. Change the title or the address");
    const before = id ? await tx.blogPost.findUnique({ where: { id }, select: { status: true, publishedAt: true, coverType: true } }) : null;
    if (id && !before) throw new Error("Post not found");
    if (d.publish && !cover && !before?.coverType) throw new Error("Add a cover picture before publishing: it is the thumbnail on Google and in shares");
    if (d.publish && !d.coverAlt) throw new Error("Describe the cover picture in a few words for people who cannot see it");
    const data = {
      slug, title: d.title, excerpt: d.excerpt, body: d.body, category: d.category, tags: cleanTags(d.tags), coverAlt: d.coverAlt, featured: d.featured,
      readingMinutes: readingMinutes(d.body), status: d.publish ? "PUBLISHED" : "DRAFT",
      publishedAt: d.publish ? (before?.publishedAt ?? new Date()) : before?.publishedAt ?? null,
      ...(cover ? { coverType: cover.type } : {}),
    };
    const post = id ? await tx.blogPost.update({ where: { id }, data }) : await tx.blogPost.create({ data: { ...data, authorId: adminId, authorName } });
    if (cover) await tx.blogCover.upsert({ where: { postId: post.id }, create: { postId: post.id, bytes: Buffer.from(cover.bytes) }, update: { bytes: Buffer.from(cover.bytes) } });
    if (d.featured) await tx.blogPost.updateMany({ where: { featured: true, id: { not: post.id } }, data: { featured: false } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "blog_post", entityId: post.id, action: d.publish ? (before?.status === "PUBLISHED" ? "blog.updated" : "blog.published") : "blog.saved", detail: { slug } });
    return post;
  });
}

export async function unpublishPost(adminId: string, id: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.blogPost.update({ where: { id }, data: { status: "DRAFT" } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "blog_post", entityId: id, action: "blog.unpublished", detail: {} });
  });
}

export async function deletePost(adminId: string, id: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.blogPost.delete({ where: { id } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "blog_post", entityId: id, action: "blog.deleted", detail: {} });
  });
}

/** Add Housy's starter guides as drafts (once each), so the administrator can add covers and publish them. */
export async function addStarterPosts(adminId: string, authorName: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    let added = 0;
    for (const s of STARTER_POSTS) {
      const slug = slugify(s.title);
      if (await tx.blogPost.findUnique({ where: { slug }, select: { id: true } })) continue;
      await tx.blogPost.create({ data: { slug, title: s.title, excerpt: s.excerpt, body: s.body, category: s.category, tags: s.tags, readingMinutes: readingMinutes(s.body), authorId: adminId, authorName, status: "DRAFT" } });
      added += 1;
    }
    return added;
  });
}
