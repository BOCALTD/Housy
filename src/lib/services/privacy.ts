import { randomBytes } from "node:crypto";
import { prisma, withTenant, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { rateLimit } from "../ratelimit";
import { hashPassword, verifyPassword } from "../auth-hash";
import { system } from "./rewards";

type Section = { name: string; rows: unknown } | { name: string; error: string };

/** Read one part of the person's data as them. A part that cannot be read is listed with a note rather than silently left out. */
async function part(userId: string, name: string, fn: (tx: Tx) => Promise<unknown>): Promise<Section> {
  try { return { name, rows: await withUser(userId, fn) }; } catch { return { name, error: "Could not be included automatically. Ask support for this part." }; }
}

/**
 * Everything the platform holds about the person that they can be given: account, companies, profile, searches, watches, follows,
 * notifications and settings, messages they sent, reviews they wrote, reports, inspections, safety sessions and identity checks
 * (without document files or full ID numbers). Company records belong to the companies and are not included.
 */
export async function exportMyData(userId: string) {
  if (!(await rateLimit(`export:${userId}`, 5, 864e5))) throw new Error("You can download your data five times a day");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, createdAt: true, mfaEnabledAt: true, isPlatformAdmin: true } });
  const sections = await Promise.all([
    part(userId, "companies", (tx) => tx.membership.findMany({ where: { userId }, select: { role: true, status: true, createdAt: true, company: { select: { name: true } } } })),
    part(userId, "agent_profiles", (tx) => tx.agentProfile.findMany({ where: { userId }, select: { displayName: true, companyName: true, headline: true, bio: true, listed: true, createdAt: true } })),
    part(userId, "saved_searches", (tx) => tx.savedSearch.findMany({ where: { userId } })),
    part(userId, "watched_properties", (tx) => tx.watchedListing.findMany({ where: { userId }, select: { listingId: true, createdAt: true } })),
    part(userId, "following", (tx) => tx.follow.findMany({ where: { followerId: userId }, select: { targetKind: true, targetId: true, createdAt: true } })),
    part(userId, "notifications", (tx) => tx.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 1000, select: { kind: true, title: true, body: true, createdAt: true, readAt: true } })),
    part(userId, "notification_settings", (tx) => tx.notificationPref.findMany({ where: { userId } })),
    part(userId, "messages_sent", (tx) => tx.message.findMany({ where: { senderId: userId }, orderBy: { createdAt: "desc" }, take: 2000, select: { conversationId: true, kind: true, body: true, createdAt: true } })),
    part(userId, "reviews_written", (tx) => tx.review.findMany({ where: { reviewerId: userId }, select: { ref: true, overall: true, body: true, status: true, createdAt: true } })),
    part(userId, "inspection_bookings", (tx) => tx.inspectionBooking.findMany({ where: { requesterId: userId }, select: { ref: true, status: true, preferredAt: true, scheduledAt: true, message: true, requesterName: true, requesterPhone: true, createdAt: true } })),
    part(userId, "safety_sessions", (tx) => tx.safetySession.findMany({ where: { userId }, select: { id: true, startedAt: true, endedAt: true, endReason: true, checkedInAt: true, emergencyAt: true, trustedName: true, trustedPhone: true, trustedEmail: true } })),
    part(userId, "safety_locations", (tx) => tx.safetyPing.findMany({ where: { userId }, select: { sessionId: true, lat: true, lng: true, accuracy: true, at: true } })),
    part(userId, "trust_and_safety_reports", (tx) => tx.trustCase.findMany({ where: { reporterId: userId }, select: { ref: true, category: true, status: true, description: true, outcomeForReporter: true, createdAt: true } })),
    part(userId, "identity_checks", (tx) => tx.kycItem.findMany({ where: { subjectUserId: userId }, select: { code: true, status: true, fields: true, secretMasked: true, docName: true, submittedAt: true, verifiedAt: true, expiresAt: true, reviewNote: true } })),
    part(userId, "vacancy_reports", (tx) => tx.vacancyReport.findMany({ where: { reporterId: userId } })),
    part(userId, "reels", (tx) => tx.reel.findMany({ where: { authorId: userId }, select: { id: true, caption: true, city: true, status: true, createdAt: true } })),
    part(userId, "referral_code", (tx) => tx.referralCode.findMany({ where: { userId } })),
    part(userId, "rewards", (tx) => tx.reward.findMany({ where: { userId } })),
  ]);
  await system((tx) => logActivity(tx, { companyId: null, actorId: userId, entityType: "user", entityId: userId, action: "privacy.export", detail: {} }));
  return {
    exported_at: new Date().toISOString(),
    note: "Your personal data held by the platform. Company records (assets, leases, payments a company recorded) belong to those companies; ask them. Identity document files and full ID numbers are not included for security; ask support to see them.",
    account: user,
    ...Object.fromEntries(sections.map((s) => [s.name, "rows" in s ? s.rows : { error: s.error }])),
  };
}

/** Why an account cannot be deleted yet, or null when it can. */
export async function deletionBlocker(userId: string) {
  const ms = await withUser(userId, (tx) => tx.membership.findMany({ where: { userId, status: "ACTIVE", role: "COMPANY_SUPER_ADMIN" }, select: { companyId: true, company: { select: { name: true } } } }));
  for (const m of ms) {
    const others = await withTenant(m.companyId, "system", (tx) => tx.membership.count({ where: { companyId: m.companyId, status: "ACTIVE", role: "COMPANY_SUPER_ADMIN", NOT: { userId } } }));
    if (others === 0) return `You are the only top administrator of ${m.company.name}. Make someone else a Company Super Admin first (Workspace → Team), or contact support to close the company.`;
  }
  const admin = await prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
  if (admin?.isPlatformAdmin) return "Platform administrator accounts are closed by another administrator, not by themselves.";
  return null;
}

/**
 * Delete an account. Personal details are removed or replaced with "Deleted user"; what other people or the law need is kept without
 * the person's name (messages others received, reviews tied to real deals, payments and invoices, Trust and Safety cases, the audit trail).
 */
export async function deleteMyAccount(userId: string, password: string, confirm: string) {
  if (confirm.trim().toUpperCase() !== "DELETE") throw new Error("Type DELETE to confirm");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, user.passwordHash))) throw new Error("That password is not right");
  const blocker = await deletionBlocker(userId);
  if (blocker) throw new Error(blocker);
  const done: string[] = [];
  const step = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); done.push(label); } catch { done.push(`${label} (left for support)`); } };

  await step("saved searches", () => withUser(userId, (tx) => tx.savedSearch.deleteMany({ where: { userId } })));
  await step("watched properties", () => withUser(userId, (tx) => tx.watchedListing.deleteMany({ where: { userId } })));
  await step("follows", () => withUser(userId, (tx) => tx.follow.deleteMany({ where: { followerId: userId } })));
  await step("notifications", () => withUser(userId, (tx) => tx.notification.deleteMany({ where: { userId } })));
  await step("notification settings", () => withUser(userId, (tx) => tx.notificationPref.deleteMany({ where: { userId } })));
  await step("safety locations", () => withUser(userId, (tx) => tx.safetyPing.deleteMany({ where: { userId } })));
  await step("safety sessions", () => withUser(userId, (tx) => tx.safetySession.updateMany({ where: { userId }, data: { trustedName: "", trustedPhone: "", trustedEmail: "", shareTokenHash: null, lastLat: null, lastLng: null, endedAt: new Date() } })));
  await step("identity checks", () => withUser(userId, (tx) => tx.kycItem.deleteMany({ where: { subjectKind: "AGENT", subjectUserId: userId } })));
  await step("public trust record", () => system((tx) => tx.trustScore.deleteMany({ where: { subjectKey: `AGENT:${userId}` } })));
  await step("inspection contact details", () => withUser(userId, (tx) => tx.inspectionBooking.updateMany({ where: { requesterId: userId, status: { in: ["COMPLETED", "CANCELLED"] } }, data: { requesterName: "Deleted user", requesterPhone: "" } })));
  await step("reviews (name removed)", () => system((tx) => tx.review.updateMany({ where: { reviewerId: userId }, data: { reviewerName: "Deleted user" } })));
  await step("agent profiles", async () => {
    const ms = await withUser(userId, (tx) => tx.membership.findMany({ where: { userId }, select: { companyId: true } }));
    for (const m of ms) await withTenant(m.companyId, userId, (tx) => tx.agentProfile.updateMany({ where: { userId, companyId: m.companyId }, data: { listed: false, displayName: "Deleted user", headline: "", bio: "" } }));
  });
  await step("company memberships", async () => {
    const ms = await withUser(userId, (tx) => tx.membership.findMany({ where: { userId }, select: { companyId: true } }));
    for (const m of ms) await withTenant(m.companyId, "system", (tx) => tx.membership.updateMany({ where: { userId, companyId: m.companyId }, data: { status: "SUSPENDED" } }));
  });
  // Last: the account itself. The email is freed for reuse; nobody can sign in again.
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.passwordReset.deleteMany({ where: { userId } }),
    prisma.mfaRecovery.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { name: "Deleted user", email: `deleted-${userId}@deleted.invalid`, passwordHash: await hashPassword(randomBytes(32).toString("base64url")), mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
  ]);
  await system((tx) => logActivity(tx, { companyId: null, actorId: userId, entityType: "user", entityId: userId, action: "privacy.account_deleted", detail: { steps: done } }));
  return done;
}
