/**
 * A workspace's country and currency. The currency follows the country: prices, payment links, plan invoices and Housy's
 * commission for the workspace are in it. Changing country is for a business that set the wrong one or moved: it is refused while
 * money is in flight in the old currency (a waiting payment link or an unpaid invoice), and the bank account clients pay into
 * is cleared, because each country's banks and online payment provider differ. Listings already published keep their own
 * currency until they are edited.
 */
import { Prisma } from "@prisma/client";
import { prisma, withPlatformAdmin, withTenant } from "../db";
import { logActivity } from "../audit";
import { assertCan, type Ctx } from "./context";
import { COUNTRIES, currencyOf, isCountry } from "../regions";

export async function businessRegion(ctx: Ctx) {
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { country: true, currency: true } }));
}

/** Country, currency and the workspace's own time zone choice ("" when it follows the country). */
export async function businessRegionFull(ctx: Ctx) {
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { country: true, currency: true, timeZone: true } }));
}

export async function changeBusinessCountry(ctx: Ctx, country: string) {
  assertCan(ctx, "billing.manage");
  if (!isCountry(country)) throw new Error("Choose a country from the list.");
  const current = await businessRegion(ctx);
  if (current.country === country) return { changedCurrency: false };
  const currency = currencyOf(country);
  const changedCurrency = currency !== current.currency;
  if (changedCurrency) {
    const [waiting, unpaid] = await Promise.all([
      withTenant(ctx.companyId, ctx.userId, (tx) => tx.clientPayment.count({ where: { companyId: ctx.companyId, status: "PENDING" } })),
      withPlatformAdmin("system", (tx) => tx.invoice.count({ where: { ownerCompanyId: ctx.companyId, status: "OPEN" } })),
    ]);
    if (waiting) throw new Error(`Cancel or settle the ${waiting} waiting payment link${waiting === 1 ? "" : "s"} under Client payments first: they are in ${current.currency}.`);
    if (unpaid) throw new Error("Pay or ask Housy to cancel your unpaid invoice under Billing first: it is in your current currency.");
  }
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { country, currency } });
    await tx.companyPaymentSettings.updateMany({ where: { companyId: ctx.companyId }, data: {
      country, currency, bankName: "", bankCode: "", accountName: "", accountNumber: "", bankDetails: Prisma.DbNull, paystackSubaccount: "", stripeAccount: "", stripeReady: false,
      ...(changedCurrency ? { inspectionFeeKobo: 0n } : {}), updatedById: ctx.userId,
    } });
    await tx.listing.updateMany({ where: { companyId: ctx.companyId, status: { in: ["DRAFT"] } }, data: { currency } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.country_changed", detail: { from: current.country, to: country, currency } });
  });
  return { changedCurrency, name: COUNTRIES[country].name, currency };
}

// ---------- Time zones, and a person's own country ----------

let zones: Set<string> | null = null;
/** Every time zone name the server knows (IANA), for checking what a form sends. */
export function timeZoneNames(): string[] {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return ["Africa/Lagos", "UTC"]; }
}
export const isTimeZone = (tz: string) => (zones ??= new Set(timeZoneNames())).has(tz) || tz === "UTC";

/** The usual time zone of a country (regions.ts), Lagos for anywhere else. */
export const countryTimeZone = (country: string): string => (isCountry(country) ? COUNTRIES[country].timeZone : "Africa/Lagos");

/** A workspace's time zone for its dates, due days and reminders. "" goes back to the country's usual one. */
export async function setWorkspaceTimeZone(ctx: Ctx, tz: string) {
  assertCan(ctx, "settings.manage");
  const t = tz.trim();
  if (t && !isTimeZone(t)) throw new Error("Choose a time zone from the list.");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { timeZone: t } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.time_zone_changed", detail: { timeZone: t || "country default" } });
  });
}

export async function myRegion(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { country: true, timeZone: true } });
  return { ...u, currency: currencyOf(u.country) };
}

/**
 * A person's own country (their own plan is priced in its currency) and the time zone they see dates in. Changing country is
 * refused while one of their own invoices is unpaid, since it is in the old currency.
 */
export async function setMyRegion(userId: string, raw: { country: string; timeZone: string }) {
  if (!isCountry(raw.country)) throw new Error("Choose a country from the list.");
  const tz = raw.timeZone.trim();
  if (tz && !isTimeZone(tz)) throw new Error("Choose a time zone from the list.");
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { country: true } });
  if (current.country !== raw.country && currencyOf(current.country) !== currencyOf(raw.country)) {
    const unpaid = await withPlatformAdmin("system", (tx) => tx.invoice.count({ where: { ownerUserId: userId, status: "OPEN" } }));
    if (unpaid) throw new Error("Pay or cancel your unpaid invoice under Plan and billing first: it is in your current currency.");
  }
  await prisma.user.update({ where: { id: userId }, data: { country: raw.country, timeZone: tz } });
  await withPlatformAdmin("system", (tx) => logActivity(tx, { companyId: null, actorId: userId, entityType: "user", entityId: userId, action: "user.region_changed", detail: { country: raw.country, timeZone: tz || "automatic" } }));
}

/** A workspace's time zone, read without a signed-in member (for times at one of its properties). */
export async function companyTimeZone(companyId: string): Promise<string> {
  const c = await withPlatformAdmin("system", (tx) => tx.company.findUnique({ where: { id: companyId }, select: { country: true, timeZone: true } }));
  return c ? c.timeZone || countryTimeZone(c.country) : "Africa/Lagos";
}
