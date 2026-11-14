/**
 * A workspace's country and currency. The currency follows the country: prices, payment links, plan invoices and Housy's
 * commission for the workspace are in it. Changing country is for a business that set the wrong one or moved: it is refused while
 * money is in flight in the old currency (a waiting payment link or an unpaid invoice), and the bank account clients pay into
 * is cleared, because each country's banks and online payment provider differ. Listings already published keep their own
 * currency until they are edited.
 */
import { Prisma } from "@prisma/client";
import { withPlatformAdmin, withTenant } from "../db";
import { logActivity } from "../audit";
import { assertCan, type Ctx } from "./context";
import { COUNTRIES, currencyOf, isCountry } from "../regions";

export async function businessRegion(ctx: Ctx) {
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { country: true, currency: true } }));
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
