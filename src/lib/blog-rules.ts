/**
 * Blog rules with no database: categories, slugs, reading time, and the small text format posts are written in
 * (paragraphs, ## and ### headings, - and 1. lists, > quotes, **bold**, *italic*, `code` and [links](url)). Pictures go in the
 * cover. Rendering never runs or injects markup.
 */

export const BLOG_CATEGORIES = {
  guides: "Renting and buying guides",
  safety: "Safety and scams",
  market: "Market and prices",
  agents: "For agents and companies",
  flatmates: "Flatmates and shared living",
  living: "Home and living",
  news: "Housy news",
} as const;
export type BlogCategory = keyof typeof BLOG_CATEGORIES;

export const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_COVER_BYTES = 2 * 1024 * 1024;
export const BLOG_PAGE = 12;

/** A web address part from a title: lower case letters, digits and single dashes, at most 80 characters. */
export function slugify(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "") || "post";
}

/** Minutes to read at about 220 words a minute, at least one. */
export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** Tags from free text: comma separated, trimmed, lower case, unique, at most 8 of up to 30 characters. */
export function cleanTags(raw: string): string[] {
  return [...new Set(raw.split(",").map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 \-]/g, "").replace(/\s+/g, " ").slice(0, 30)).filter((t) => t.length >= 2))].slice(0, 8);
}

export type Inline = { t: "text" | "b" | "i" | "code"; v: string } | { t: "a"; v: string; href: string; external: boolean };
export type Block =
  | { t: "p"; parts: Inline[] }
  | { t: "h2" | "h3"; text: string; id: string }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; parts: Inline[] };

/** Only site paths, https links and mail links are kept as links; anything else stays plain text. */
export function safeHref(href: string): { href: string; external: boolean } | null {
  const h = href.trim();
  if (/^\/(?!\/)[^\s]*$/.test(h)) return { href: h, external: false };
  if (/^https:\/\/[^\s/]+\.[^\s]+$/i.test(h)) return { href: h, external: true };
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return { href: h, external: true };
  return null;
}

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ t: "text", v: s.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ t: "b", v: tok.slice(2, -2) });
    else if (tok.startsWith("`")) out.push({ t: "code", v: tok.slice(1, -1) });
    else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const safe = safeHref(mm[2]);
      out.push(safe ? { t: "a", v: mm[1], ...safe } : { t: "text", v: mm[1] });
    } else out.push({ t: "i", v: tok.slice(1, -1) });
    last = m.index! + tok.length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

/** The post body as blocks, with ids on headings for a table of contents. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  const ids = new Map<string, number>();
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: Inline[][] } | null = null;
  let quote: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", parts: inline(para.join(" ")) }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  const flushQuote = () => { if (quote.length) { blocks.push({ t: "quote", parts: inline(quote.join(" ")) }); quote = []; } };
  const flush = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) { flush(); continue; }
    if (h) {
      flush();
      const text = h[2].replace(/[*`]/g, "").trim();
      let id = slugify(text); const n = ids.get(id) ?? 0; ids.set(id, n + 1); if (n) id = `${id}-${n + 1}`;
      blocks.push({ t: h[1].length === 2 ? "h2" : "h3", text, id });
    } else if (ul || ol) {
      flushPara(); flushQuote();
      const t = ul ? "ul" : "ol";
      if (!list || list.t !== t) { flushList(); list = { t, items: [] }; }
      list.items.push(inline((ul ?? ol)![1]));
    } else if (q) { flushPara(); flushList(); quote.push(q[1]); }
    else { flushList(); flushQuote(); para.push(line.trim()); }
  }
  flush();
  return blocks;
}

/** Plain words of a post (for search snippets and descriptions). */
export function plainText(body: string): string {
  return body.replace(/^#{1,6}\s+/gm, "").replace(/^\s*([-*•]|\d+[.)])\s+/gm, "").replace(/^>\s?/gm, "").replace(/\*\*|`|\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
}
