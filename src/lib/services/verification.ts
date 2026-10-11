import { z } from "zod";
import { prisma } from "../db";
import { hashToken, newToken, randomRef } from "../tokens";
import { rateLimit } from "../ratelimit";
import { getPublicListing } from "./listings";

// Property verification recommendations (master prompt Section 9).

export const MODAL_VERSION = "v1.1";
export const CONSENT_TEXT_VERSION = "consent-2026-10-v1";
export const TRIGGERS = ["view", "save", "enquiry", "offer", "manual"] as const;

export const SUPPRESS_DECLINE_DAYS = Number(process.env.VERIFY_DECLINE_DAYS ?? 90);
export const SUPPRESS_LATER_HOURS = Number(process.env.VERIFY_LATER_HOURS ?? 24);
export const RECOMMEND_FOR_RENTALS = process.env.VERIFY_RECOMMEND_RENTALS === "true";

export type Prefs = { declinedAt?: number; laterAt?: number };

/** Whether the modal may open automatically for this visitor and listing purpose. */
export function shouldAutoShow(prefs: Prefs, purpose: string, now = Date.now()): boolean {
  if (purpose !== "SALE" && !RECOMMEND_FOR_RENTALS) return false;
  if (prefs.declinedAt && now - prefs.declinedAt < SUPPRESS_DECLINE_DAYS * 864e5) return false;
  if (prefs.laterAt && now - prefs.laterAt < SUPPRESS_LATER_HOURS * 36e5) return false;
  return true;
}

export function parsePrefs(raw: string | undefined): Prefs {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return { declinedAt: Number(v.declinedAt) || undefined, laterAt: Number(v.laterAt) || undefined };
  } catch {
    return {};
  }
}

/** The approved, featured provider to recommend, or null if none is approved. */
export async function getFeaturedProvider() {
  return prisma.serviceProvider.findFirst({
    where: { status: "APPROVED" },
    orderBy: [{ featured: "desc" }, { createdAt: "asc" }],
  });
}

export async function recordRecommendationEvent(input: {
  providerId: string; listingRef: string; userId: string | null; visitorKey: string;
  trigger: string; event: "IMPRESSION" | "CONFIRMED_INTEREST" | "DECLINED" | "LATER";
}) {
  const trigger = (TRIGGERS as readonly string[]).includes(input.trigger) ? input.trigger : "view";
  const provider = await prisma.serviceProvider.findFirst({ where: { id: input.providerId, status: "APPROVED" } });
  if (!provider) throw new Error("Provider not available");
  if (!rateLimit(`rec:${input.visitorKey}`, 120, 60 * 60 * 1000)) return;
  await prisma.recommendationEvent.create({
    data: {
      providerId: provider.id, listingRef: input.listingRef.slice(0, 40), userId: input.userId,
      visitorKey: input.visitorKey.slice(0, 64), trigger, modalVersion: MODAL_VERSION, event: input.event,
      // An impression always starts with "Yes" preselected. That default is never counted as interest.
      preselected: input.event === "IMPRESSION",
    },
  });
}

const leadSchema = z.object({
  providerId: z.string().min(1),
  listingRef: z.string().min(1).max(40),
  name: z.string().trim().min(2, "Enter your full name").max(120),
  contactMethod: z.enum(["phone", "whatsapp", "email"]),
  contactValue: z.string().trim().min(5, "Enter how the provider should contact you").max(200),
  note: z.string().trim().max(1000).default(""),
  consent: z.literal("yes", { errorMap: () => ({ message: "Tick the box to agree to share these details" }) }),
});

/**
 * Create a provider lead. Personal data is stored and shared only after explicit consent.
 * Returns the reference and a one-time access token for the visitor's status page.
 */
export async function submitLead(input: z.input<typeof leadSchema>, userId: string | null, clientKey: string) {
  if (!rateLimit(`lead:${clientKey}`, 5, 60 * 60 * 1000)) throw new Error("Too many requests. Try again later.");
  const data = leadSchema.parse(input);
  if (data.contactMethod === "email" && !z.string().email().safeParse(data.contactValue).success) {
    throw new Error("Enter a valid email address");
  }
  const provider = await prisma.serviceProvider.findFirst({ where: { id: data.providerId, status: "APPROVED" } });
  if (!provider) throw new Error("This provider is not available right now");
  const listing = await getPublicListing(data.listingRef);
  if (!listing) throw new Error("This property is no longer available");
  const token = newToken(24);
  const lead = await prisma.providerLead.create({
    data: {
      ref: randomRef("PV", 8), accessTokenHash: hashToken(token), providerId: provider.id,
      listingRef: listing.publicRef, userId, name: data.name, contactMethod: data.contactMethod,
      contactValue: data.contactValue, note: data.note, consentTextVersion: CONSENT_TEXT_VERSION,
      consentGivenAt: new Date(),
    },
  });
  return { ref: lead.ref, token };
}

export async function getLeadForVisitor(ref: string, token: string) {
  const lead = await prisma.providerLead.findUnique({ where: { ref }, include: { provider: { select: { name: true, shortName: true } } } });
  if (!lead || lead.accessTokenHash !== hashToken(token)) return null;
  return lead;
}

/** Withdraw consent: stop further handling and remove the contact details from the lead. */
export async function withdrawLead(ref: string, token: string) {
  const lead = await getLeadForVisitor(ref, token);
  if (!lead) throw new Error("Request not found");
  if (lead.status === "WITHDRAWN" || lead.status === "CLOSED") return;
  await prisma.providerLead.update({
    where: { id: lead.id },
    data: { status: "WITHDRAWN", withdrawnAt: new Date(), contactValue: "[withdrawn]", note: "" },
  });
}

// ---------- Platform administration ----------

const providerSchema = z.object({
  name: z.string().trim().min(2).max(200),
  shortName: z.string().trim().min(2).max(12),
  profile: z.string().trim().max(2000).default(""),
  services: z.string().trim().max(2000).default(""),
  coverage: z.string().trim().max(500).default(""),
  link: z.string().trim().max(300).default("").refine((v) => v === "" || /^https:\/\//.test(v), "Profile links must start with https://"),
  status: z.enum(["PENDING", "APPROVED", "SUSPENDED"]),
  placement: z.enum(["SPONSORED", "AFFILIATED", "EDITORIAL"]),
  featured: z.boolean(),
});

export async function saveProvider(id: string | null, input: z.input<typeof providerSchema>) {
  const data = providerSchema.parse(input);
  if (data.featured) await prisma.serviceProvider.updateMany({ where: { featured: true }, data: { featured: false } });
  if (id) return prisma.serviceProvider.update({ where: { id }, data });
  return prisma.serviceProvider.create({ data });
}

export async function verificationMetrics() {
  const grouped = await prisma.recommendationEvent.groupBy({ by: ["event"], _count: { _all: true } });
  const count = (e: string) => grouped.find((g) => g.event === e)?._count._all ?? 0;
  const leads = await prisma.providerLead.groupBy({ by: ["status"], _count: { _all: true } });
  const leadTotal = leads.reduce((s, l) => s + l._count._all, 0);
  const followedUp = leads.filter((l) => l.status !== "SUBMITTED").reduce((s, l) => s + l._count._all, 0);
  return {
    impressions: count("IMPRESSION"),
    preselectedShown: count("IMPRESSION"),
    confirmedInterest: count("CONFIRMED_INTEREST"),
    declined: count("DECLINED"),
    later: count("LATER"),
    leads: leadTotal,
    followedUp,
  };
}
