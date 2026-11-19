/**
 * Legal pages written and published by the platform administrator (Admin, Legal pages): the terms, the privacy policy, and any
 * other page they add. The wording is theirs (and their lawyer's); Housy only keeps the versions and shows them.
 *
 * - Each change is a new version. A draft can be edited; a published version never changes (the database refuses it). Publishing
 *   retires the version before it, and earlier versions stay readable from the page's history.
 * - A version can take effect on a later date; until then the page shows the version in force and says when the new one starts.
 * - A material change to the terms or the privacy policy asks signed-in people to agree again, once it is in effect.
 * - Until a page has a published version, the built-in text (lib/legal.ts) is shown.
 */
import { z } from "zod";
import { prisma, withPlatformAdmin, withPublic } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, toDateOnlyString, todayInLagos } from "../dates";
import { LEGAL_VERSION, LEGAL_UPDATED, legalDoc, legalDocs } from "../legal";
import { recordConsent } from "./privacy";

export const CONSENT_SLUGS = ["terms", "privacy"] as const;

export type ShownLegal = {
  slug: string; title: string; summary: string; body: string; version: number | null; updated: string;
  builtIn: boolean; status: "PUBLISHED" | "RETIRED" | "BUILT_IN" | "DRAFT"; changeNote: string; effectiveFrom: string | null;
  upcoming: { version: number; effectiveFrom: string } | null;
};

const dateText = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);

async function inForce(slug: string, today = todayInLagos()) {
  return withPublic((tx) => tx.legalPageVersion.findFirst({ where: { slug, status: { in: ["PUBLISHED", "RETIRED"] }, OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] }, orderBy: { version: "desc" } }));
}

/** The page as the public sees it today (or one earlier version, by number). */
export async function legalPage(slug: string, version?: number): Promise<ShownLegal | null> {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(slug)) return null;
  if (version) {
    const v = await withPublic((tx) => tx.legalPageVersion.findFirst({ where: { slug, version, status: { in: ["PUBLISHED", "RETIRED"] } } }));
    if (!v) return null;
    return { slug, title: v.title, summary: v.summary, body: v.body, version: v.version, updated: dateText(v.effectiveFrom ?? v.publishedAt!), builtIn: false, status: v.status as "PUBLISHED", changeNote: v.changeNote, effectiveFrom: v.effectiveFrom ? toDateOnlyString(v.effectiveFrom) : null, upcoming: null };
  }
  const today = todayInLagos();
  const [cur, next] = await Promise.all([
    inForce(slug, today),
    withPublic((tx) => tx.legalPageVersion.findFirst({ where: { slug, status: "PUBLISHED", effectiveFrom: { gt: today } }, orderBy: { version: "desc" } })),
  ]);
  const upcoming = next ? { version: next.version, effectiveFrom: dateText(next.effectiveFrom!) } : null;
  if (cur) return { slug, title: cur.title, summary: cur.summary, body: cur.body, version: cur.version, updated: dateText(cur.effectiveFrom ?? cur.publishedAt!), builtIn: false, status: "PUBLISHED", changeNote: cur.changeNote, effectiveFrom: cur.effectiveFrom ? toDateOnlyString(cur.effectiveFrom) : null, upcoming };
  const d = legalDoc(slug);
  if (!d) return next ? { slug, title: next.title, summary: next.summary, body: "", version: null, updated: "", builtIn: false, status: "BUILT_IN", changeNote: "", effectiveFrom: null, upcoming } : null;
  return { ...d, version: null, updated: LEGAL_UPDATED, builtIn: true, status: "BUILT_IN", changeNote: "", effectiveFrom: null, upcoming };
}

/** Every legal page there is: the built-in ones, and any page the administrator has published. */
export async function legalIndex() {
  const published = await withPublic((tx) => tx.legalPageVersion.findMany({ where: { status: { in: ["PUBLISHED", "RETIRED"] } }, orderBy: [{ slug: "asc" }, { version: "desc" }], select: { slug: true, title: true, summary: true, effectiveFrom: true } }));
  const today = todayInLagos();
  const latest = new Map<string, { title: string; summary: string }>();
  for (const p of published) if (!latest.has(p.slug) && (!p.effectiveFrom || p.effectiveFrom <= today)) latest.set(p.slug, p);
  const built = legalDocs().map((d) => ({ slug: d.slug, title: latest.get(d.slug)?.title ?? d.title, summary: latest.get(d.slug)?.summary ?? d.summary }));
  const extra = [...latest.entries()].filter(([s]) => !built.some((b) => b.slug === s)).map(([slug, v]) => ({ slug, title: v.title, summary: v.summary }));
  return [...built, ...extra];
}

/** The published versions of a page, newest first. */
export async function legalHistory(slug: string) {
  return withPublic((tx) => tx.legalPageVersion.findMany({ where: { slug, status: { in: ["PUBLISHED", "RETIRED"] } }, orderBy: { version: "desc" }, select: { version: true, publishedAt: true, effectiveFrom: true, changeNote: true, material: true }, take: 50 }));
}

// ---------- Agreeing to the terms ----------

/**
 * The version people agree to: the latest material versions of the terms and the privacy policy that are in effect, or the built-in
 * version while neither has one.
 */
let cachedConsent: { at: number; day: string; value: string } | null = null;
export async function consentVersion(today = todayInLagos()): Promise<string> {
  const day = toDateOnlyString(today);
  if (cachedConsent && cachedConsent.day === day && Date.now() - cachedConsent.at < 60_000) return cachedConsent.value;
  const parts: string[] = [];
  for (const slug of CONSENT_SLUGS) {
    const v = await withPublic((tx) => tx.legalPageVersion.findFirst({ where: { slug, material: true, status: { in: ["PUBLISHED", "RETIRED"] }, OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] }, orderBy: { version: "desc" }, select: { version: true } }));
    if (v) parts.push(`${slug}-v${v.version}`);
  }
  const value = parts.length ? parts.join("+") : LEGAL_VERSION;
  cachedConsent = { at: Date.now(), day, value };
  return value;
}

/** Whether a signed-in person must agree again. People who joined before versions were kept agreed to the built-in version. */
export async function needsConsent(userId: string) {
  const [u, cur] = await Promise.all([prisma.user.findUnique({ where: { id: userId }, select: { legalAccepted: true } }), consentVersion()]);
  if (!u) return false;
  return (u.legalAccepted || LEGAL_VERSION) !== cur;
}

export async function acceptLegal(userId: string) {
  const v = await consentVersion();
  await prisma.user.update({ where: { id: userId }, data: { legalAccepted: v } });
  await recordConsent(userId, v);
  return v;
}

// ---------- Writing and publishing (platform administrator) ----------

async function adminOnly(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

const draftSchema = z.object({
  title: z.string().trim().min(3, "Give the page a title").max(120),
  summary: z.string().trim().max(300).default(""),
  body: z.string().trim().min(50, "Write the page's text (at least a few sentences)").max(100_000, "The page is too long (100,000 characters at most)"),
  changeNote: z.string().trim().max(300).default(""),
  material: z.boolean().default(false),
  effectiveFrom: z.string().trim().default(""),
});

export function cleanSlug(raw: string) {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(slug)) throw new Error("Use a short web address for the page: lower-case letters, digits and dashes, such as refund-policy");
  return slug;
}

export async function legalAdminList(adminId: string) {
  await adminOnly(adminId);
  const rows = await withPlatformAdmin(adminId, (tx) => tx.legalPageVersion.findMany({ orderBy: [{ slug: "asc" }, { version: "desc" }], select: { id: true, slug: true, version: true, title: true, status: true, publishedAt: true, effectiveFrom: true, updatedAt: true, material: true } }));
  const slugs = [...new Set([...legalDocs().map((d) => d.slug), ...rows.map((r) => r.slug)])];
  return slugs.map((slug) => {
    const mine = rows.filter((r) => r.slug === slug);
    return { slug, title: mine[0]?.title ?? legalDoc(slug)?.title ?? slug, draft: mine.find((r) => r.status === "DRAFT") ?? null, published: mine.find((r) => r.status === "PUBLISHED") ?? null, versions: mine.filter((r) => r.status !== "DRAFT").length };
  });
}

/** The page's draft (or a starting text: the version in force, or the built-in text), and its versions. */
export async function legalEditor(adminId: string, slugRaw: string) {
  await adminOnly(adminId);
  const slug = cleanSlug(slugRaw);
  const rows = await withPlatformAdmin(adminId, (tx) => tx.legalPageVersion.findMany({ where: { slug }, orderBy: { version: "desc" } }));
  const draft = rows.find((r) => r.status === "DRAFT") ?? null;
  const current = rows.find((r) => r.status === "PUBLISHED") ?? null;
  const built = legalDoc(slug);
  const start = draft ?? current ?? (built ? { title: built.title, summary: built.summary, body: built.body } : null);
  return { slug, draft, current, start, builtIn: !!built, versions: rows.filter((r) => r.status !== "DRAFT") };
}

export async function saveLegalDraft(adminId: string, slugRaw: string, raw: z.input<typeof draftSchema>) {
  await adminOnly(adminId);
  const slug = cleanSlug(slugRaw);
  const d = draftSchema.parse(raw);
  const effectiveFrom = d.effectiveFrom ? parseDateOnly(d.effectiveFrom) : null;
  if (effectiveFrom && effectiveFrom < todayInLagos()) throw new Error("The date it takes effect cannot be in the past");
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legal:${slug}`}))`;
    const draft = await tx.legalPageVersion.findFirst({ where: { slug, status: "DRAFT" } });
    const data = { title: d.title, summary: d.summary, body: d.body, changeNote: d.changeNote, material: d.material, effectiveFrom };
    const row = draft
      ? await tx.legalPageVersion.update({ where: { id: draft.id }, data })
      : await tx.legalPageVersion.create({ data: { slug, version: ((await tx.legalPageVersion.aggregate({ where: { slug }, _max: { version: true } }))._max.version ?? 0) + 1, createdById: adminId, ...data } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "legal_page", entityId: row.id, action: "legal.draft_saved", detail: { slug, version: row.version } });
    return row;
  });
}

export async function publishLegal(adminId: string, slugRaw: string) {
  await adminOnly(adminId);
  const slug = cleanSlug(slugRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legal:${slug}`}))`;
    const draft = await tx.legalPageVersion.findFirst({ where: { slug, status: "DRAFT" } });
    if (!draft) throw new Error("There is no draft to publish");
    if ((CONSENT_SLUGS as readonly string[]).includes(slug) && !draft.changeNote.trim()) throw new Error("Say what changed (the change note), so people know what they are agreeing to");
    if (draft.effectiveFrom && draft.effectiveFrom < todayInLagos()) throw new Error("The date it takes effect has passed. Change it or clear it, then publish.");
    // The version in force is retired (it stays in force until the new one's date). A version still waiting for its date is
    // withdrawn: it never comes into force.
    const today = todayInLagos();
    await tx.legalPageVersion.updateMany({ where: { slug, status: "PUBLISHED", effectiveFrom: { gt: today } }, data: { status: "WITHDRAWN" } });
    await tx.legalPageVersion.updateMany({ where: { slug, status: "PUBLISHED" }, data: { status: "RETIRED" } });
    const row = await tx.legalPageVersion.update({ where: { id: draft.id }, data: { status: "PUBLISHED", publishedById: adminId, publishedAt: new Date() } });
    cachedConsent = null;
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "legal_page", entityId: row.id, action: "legal.published", detail: { slug, version: row.version, material: row.material, effectiveFrom: row.effectiveFrom ? toDateOnlyString(row.effectiveFrom) : null } });
    return row;
  });
}

export async function discardLegalDraft(adminId: string, slugRaw: string) {
  await adminOnly(adminId);
  const slug = cleanSlug(slugRaw);
  await withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.legalPageVersion.deleteMany({ where: { slug, status: "DRAFT" } });
    if (r.count) await logActivity(tx, { companyId: null, actorId: adminId, entityType: "legal_page", entityId: slug, action: "legal.draft_discarded", detail: { slug } });
  });
}
