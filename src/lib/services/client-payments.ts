/**
 * Payments from clients to companies and agents through Housy: rent (from a lease's charges), inspection fees and other amounts
 * (deposits, service charges, fees), in the company's own currency. Each is paid:
 *  - online, through the provider serving the company's country (Admin → Settings):
 *    - Paystack (Nigeria, Ghana, Kenya, South Africa) splits the payment, sending Housy's commission to Housy and the rest to the
 *      company's bank through its Paystack settlement account (subaccount), which Housy creates from the company's bank details;
 *    - Stripe (the US, UK, Canada, Europe, Australia, the UAE) pays the company's own Stripe account, which the company sets up
 *      on Stripe's page with its bank details, less Housy's commission (an application fee); or
 *  - by direct transfer to the company's bank account, which the company confirms. Rent the company records as received
 *    directly also counts. Housy's commission on these is invoiced to the company each month.
 * The commission percentage (Admin → Settings) is fixed on each payment when it is requested.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { withPlatformAdmin, withTenant, withUser, type Tx } from "../db";
import { lockKey } from "../locks";
import { logActivity } from "../audit";
import { formatKobo, parseNairaToKobo } from "../money";
import { randomRef } from "../tokens";
import { notify } from "./notifications";
import { post } from "./billing";
import { platformConfig, onlineProviderFor, paymentProviderNamed, type CommissionKind } from "./platform-config";
import { paystackSplitApi, stripeConnectApi, type Bank } from "../payment-providers";
import { PAYSTACK_COUNTRIES, bankFieldsFor, bankLines, checkBankDetails, isCountry, type Country } from "../regions";
import { clientPaymentRef, commissionOf, isClientPaymentRef, nubanProblem, previousMonth, type ClientPaymentKind } from "../client-payment-rules";
import { postReceiptIn } from "./leases";
import { assertCan, type Ctx } from "./context";
import { todayInLagos } from "../dates";

const SYSTEM = "system";
const system = <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(SYSTEM, fn);
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const COMMISSION_FOR: Record<ClientPaymentKind, CommissionKind> = { RENT: "RENT", INSPECTION: "INSPECTION", OTHER: "OTHER" };

async function splitApi() {
  const c = await platformConfig();
  return c.paystack.secret ? paystackSplitApi(c.paystack.secret) : null;
}

async function stripeApi() {
  const c = await platformConfig();
  return c.stripe.secret ? stripeConnectApi(c.stripe.secret) : null;
}

const regionOf = (tx: Tx, companyId: string) => tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { country: true, currency: true, name: true, contactEmail: true, suspendedAt: true } });

const bankCache = new Map<string, { at: number; banks: Bank[] }>();
/** The banks in a Paystack country as Paystack lists them (for choosing where online payments settle). Empty elsewhere or when Paystack is not connected. */
export async function banks(country = "NG"): Promise<Bank[]> {
  const where = isCountry(country) ? PAYSTACK_COUNTRIES[country] : undefined;
  if (!where) return [];
  const hit = bankCache.get(country);
  if (hit && Date.now() - hit.at < 86_400_000 && hit.banks.length) return hit.banks;
  const api = await splitApi();
  if (!api) return [];
  const list = await api.banks(where.bankListCountry, where.currency).catch(() => []);
  if (list.length) bankCache.set(country, { at: Date.now(), banks: list });
  return list;
}

/** The limits for an inspection fee in a currency: in naira ₦500 to ₦100,000; elsewhere 1 to 1,000 of the currency. */
const feeLimits = (currency: string) => (currency === "NGN" ? { min: 50_000n, max: 10_000_000n } : { min: 100n, max: 100_000n });

// ---------- The company's payment settings ----------

export async function paymentSettings(ctx: Ctx) {
  assertCan(ctx, "billing.view");
  const [found, cfg, region] = await Promise.all([
    withTenant(ctx.companyId, ctx.userId, (tx) => tx.companyPaymentSettings.findUnique({ where: { companyId: ctx.companyId } })),
    platformConfig(),
    withTenant(ctx.companyId, ctx.userId, (tx) => regionOf(tx, ctx.companyId)),
  ]);
  let s = found;
  const provider = await onlineProviderFor(region.country);
  // A company that has just finished Stripe's set-up: ask Stripe whether the account can take payments now.
  if (provider === "STRIPE" && s?.stripeAccount && !s.stripeReady) {
    const api = await stripeApi();
    if (api && (await api.accountReady(s.stripeAccount).catch(() => false))) {
      s = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.companyPaymentSettings.update({ where: { companyId: ctx.companyId }, data: { stripeReady: true } }));
    }
  }
  const online = provider === "PAYSTACK" ? !!s?.paystackSubaccount : provider === "STRIPE" ? !!s?.stripeReady : false;
  const details = (s?.bankDetails ?? null) as Record<string, string> | null;
  return {
    settings: s, country: region.country, currency: region.currency, provider, online,
    paystackConnected: provider === "PAYSTACK", stripeConnected: provider === "STRIPE",
    bankFields: bankFieldsFor(region.country), details,
    lines: details ? bankLines(s?.country ?? region.country, details) : s?.accountNumber ? [{ label: "Bank", value: s.bankName }, { label: "Account name", value: s.accountName }, { label: "Account number", value: s.accountNumber }] : [],
    commissionBps: cfg.commissionBps,
  };
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Save the bank account clients pay into, with the details a payer needs in the company's country (a NUBAN in Nigeria, a sort
 * code in the UK, a routing number in the US, an IBAN in Europe and so on).
 *  - In a Paystack country with Paystack connected, the bank is chosen from Paystack's list (in Nigeria the bank confirms the
 *    account name) and Housy creates or updates the company's settlement account, so online payments reach this bank.
 *  - Elsewhere the account is shown to payers for direct transfers; online payments go through the company's Stripe account,
 *    set up separately on Stripe's page (connectStripe).
 */
export async function saveBankAccount(ctx: Ctx, raw: Record<string, string | undefined>) {
  assertCan(ctx, "billing.manage");
  const region = await withTenant(ctx.companyId, ctx.userId, (tx) => regionOf(tx, ctx.companyId));
  const country = region.country;
  const provider = await onlineProviderFor(country);
  const current = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.companyPaymentSettings.findUnique({ where: { companyId: ctx.companyId } }));
  let details: Record<string, string>, bankCode = "", subaccount = current?.country === country ? current?.paystackSubaccount ?? "" : "";
  const api = provider === "PAYSTACK" ? await splitApi() : null;
  if (api) {
    const accountNumber = clean(raw.accountNumber).replace(/[\s-]/g, "");
    const bad = country === "NG" ? nubanProblem(accountNumber) : /^\d{6,18}$/.test(accountNumber) ? null : "Enter the account number (digits only).";
    if (bad) throw new Error(bad);
    bankCode = clean(raw.bankCode);
    if (!bankCode) throw new Error("Choose the bank.");
    const bank = (await banks(country)).find((b) => b.code === bankCode);
    if (!bank) throw new Error("Choose the bank from the list.");
    let accountName = clean(raw.accountName);
    if (country === "NG") {
      const resolved = await api.resolveAccount(accountNumber, bankCode);
      if (!resolved.ok) throw new Error(resolved.error);
      accountName = resolved.accountName;
    } else if (accountName.length < 2) throw new Error("Enter the account name exactly as the bank shows it.");
    if (subaccount) {
      const u = await api.updateSubaccount(subaccount, { businessName: region.name, bankCode, accountNumber });
      if (!u.ok) throw new Error(`Paystack did not accept the new account: ${u.error}`);
    } else {
      const c = await api.createSubaccount({ businessName: region.name, bankCode, accountNumber, contactEmail: region.contactEmail });
      if (!c.ok) throw new Error(`Paystack did not set up online payments for this account: ${c.error}`);
      subaccount = c.code;
    }
    details = { bankName: bank.name, accountName, accountNumber };
  } else {
    const checked = checkBankDetails(country, Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, clean(v)])));
    if (!checked.ok) throw new Error(checked.problem);
    details = checked.details;
  }
  const summary = { bankName: details.bankName ?? "", accountName: details.accountName ?? "", accountNumber: details.accountNumber ?? details.iban ?? "" };
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const data = { ...summary, bankCode, bankDetails: details, country, currency: region.currency, paystackSubaccount: subaccount, updatedById: ctx.userId };
    await tx.companyPaymentSettings.upsert({ where: { companyId: ctx.companyId }, create: { companyId: ctx.companyId, ...data }, update: data });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "payment_settings", entityId: ctx.companyId, action: "payments.bank_account_saved", detail: { bank: summary.bankName, account: `••••${summary.accountNumber.slice(-4)}`, country, online: !!subaccount } });
  });
  return { accountName: summary.accountName, online: !!subaccount };
}

/**
 * Online payments outside Paystack's countries: the company's own Stripe account, which Stripe checks and pays out to the
 * company's bank. Returns Stripe's set-up page (a fresh link each time; Stripe's links expire within minutes).
 */
export async function connectStripe(ctx: Ctx, returnUrl: string) {
  assertCan(ctx, "billing.manage");
  const region = await withTenant(ctx.companyId, ctx.userId, (tx) => regionOf(tx, ctx.companyId));
  if ((await onlineProviderFor(region.country)) !== "STRIPE") throw new Error("Online payments in your country do not go through Stripe.");
  const api = await stripeApi();
  if (!api) throw new Error("Online payments are not switched on for your country yet. Clients can pay you by bank transfer.");
  const current = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.companyPaymentSettings.findUnique({ where: { companyId: ctx.companyId } }));
  let account = current?.country === region.country ? current?.stripeAccount ?? "" : "";
  if (!account) {
    const made = await api.createAccount({ country: region.country, email: region.contactEmail, businessName: region.name });
    if (!made.ok) throw new Error(`Stripe did not set up an account: ${made.error}`);
    account = made.id;
    await withTenant(ctx.companyId, ctx.userId, async (tx) => {
      const data = { stripeAccount: account, stripeReady: false, country: region.country, currency: region.currency, updatedById: ctx.userId };
      await tx.companyPaymentSettings.upsert({ where: { companyId: ctx.companyId }, create: { companyId: ctx.companyId, ...data }, update: data });
      await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "payment_settings", entityId: ctx.companyId, action: "payments.stripe_started", detail: { country: region.country } });
    });
  }
  const link = await api.onboardingLink(account, returnUrl);
  if (!link.ok) throw new Error(`Stripe's set-up page could not be opened: ${link.error}`);
  return link.url;
}

/** The company's inspection fee: 0 keeps inspections free. Applies to inspections confirmed after the change. */
export async function saveInspectionFee(ctx: Ctx, feeInput: string) {
  assertCan(ctx, "billing.manage");
  const { currency } = await withTenant(ctx.companyId, ctx.userId, (tx) => regionOf(tx, ctx.companyId));
  const lim = feeLimits(currency);
  let fee = 0n;
  const t = feeInput.trim();
  if (t && !/^0+(\.0+)?$/.test(t)) { try { fee = parseNairaToKobo(t); } catch { throw new Error(`Enter the fee, for example ${formatKobo(lim.min * 10n, currency)}, or 0 for free inspections.`); } }
  if (fee > 0n && fee < lim.min) throw new Error(`An inspection fee must be at least ${formatKobo(lim.min, currency)}, or 0 for free inspections.`);
  if (fee > lim.max) throw new Error(`An inspection fee cannot be more than ${formatKobo(lim.max, currency)}.`);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.companyPaymentSettings.upsert({ where: { companyId: ctx.companyId }, create: { companyId: ctx.companyId, inspectionFeeKobo: fee, updatedById: ctx.userId }, update: { inspectionFeeKobo: fee, updatedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "payment_settings", entityId: ctx.companyId, action: "payments.inspection_fee_saved", detail: { feeKobo: fee.toString() } });
  });
}

// ---------- Payment requests ----------

async function createRequest(tx: Tx, ctx: Ctx, d: { kind: ClientPaymentKind; description: string; amountKobo: bigint; payerName: string; payerEmail: string; payerUserId?: string | null; leaseId?: string | null; chargeId?: string | null; bookingId?: string | null }) {
  const bps = (await platformConfig()).commissionBps[COMMISSION_FOR[d.kind]];
  const { currency } = await regionOf(tx, ctx.companyId);
  const token = randomBytes(24).toString("base64url");
  const p = await tx.clientPayment.create({ data: {
    ref: clientPaymentRef(), companyId: ctx.companyId, kind: d.kind, description: d.description.slice(0, 300), amountKobo: d.amountKobo, currency,
    commissionBps: bps, commissionKobo: commissionOf(d.amountKobo, bps), payerName: d.payerName.slice(0, 200), payerEmail: d.payerEmail.slice(0, 200),
    payerUserId: d.payerUserId ?? null, leaseId: d.leaseId ?? null, chargeId: d.chargeId ?? null, bookingId: d.bookingId ?? null,
    tokenHash: hashToken(token), createdById: ctx.userId,
  } });
  await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client_payment", entityId: p.id, action: "payments.requested", detail: { ref: p.ref, kind: d.kind, amountKobo: d.amountKobo.toString() } });
  return { payment: p, link: `/pay/${token}` };
}

/** A payment link for what is still owed on one rent charge, to send to the tenant. */
export async function requestRentPayment(ctx: Ctx, chargeId: string, payer: { name: string; email: string }) {
  assertCan(ctx, "payment.record");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.rentCharge.findFirst({ where: { id: chargeId, companyId: ctx.companyId }, include: { lease: { select: { id: true, ref: true, occupantName: true } } } });
    if (!c) throw new Error("Rent charge not found.");
    const owed = c.amountKobo + c.adjustedKobo - c.paidKobo;
    if (owed <= 0n) throw new Error("Nothing is owed on this charge.");
    if (await tx.clientPayment.findFirst({ where: { chargeId, status: "PENDING" } })) throw new Error("A payment link for this charge is already waiting. Cancel it first to make a new one.");
    return createRequest(tx, ctx, { kind: "RENT", description: `Rent due ${c.dueDate.toISOString().slice(0, 10)}, lease ${c.lease.ref}`, amountKobo: owed, payerName: payer.name || c.lease.occupantName, payerEmail: payer.email, leaseId: c.lease.id, chargeId });
  });
}

const otherSchema = z.object({
  description: z.string().trim().min(3, "Say what the payment is for").max(300),
  amount: z.string().transform((v, c) => { try { return parseNairaToKobo(v); } catch { c.addIssue({ code: "custom", message: "Enter the amount, for example 25,000 or 1250.50" }); return 0n; } }),
  payerName: z.string().trim().min(2, "Enter the payer's name").max(200),
  payerEmail: z.string().trim().max(200).default(""),
});
/** A payment link for any other amount: a deposit, service charge, legal fee and so on. */
export async function requestOtherPayment(ctx: Ctx, raw: z.input<typeof otherSchema>) {
  assertCan(ctx, "payment.record");
  const d = otherSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { currency } = await regionOf(tx, ctx.companyId);
    const least = currency === "NGN" ? 10_000n : 100n;
    if (d.amount < least) throw new Error(`The amount must be at least ${formatKobo(least, currency)}.`);
    return createRequest(tx, ctx, { kind: "OTHER", description: d.description, amountKobo: d.amount, payerName: d.payerName, payerEmail: d.payerEmail });
  });
}

/** When an inspection is confirmed and the company charges for inspections, the person is asked to pay the fee through Housy. */
export async function requestInspectionFeeIn(tx: Tx, ctx: Ctx, booking: { id: string; ref: string; requesterId: string; requesterName: string }) {
  const s = await tx.companyPaymentSettings.findUnique({ where: { companyId: ctx.companyId }, select: { inspectionFeeKobo: true } });
  if (!s || s.inspectionFeeKobo <= 0n) return null;
  if (await tx.clientPayment.findFirst({ where: { bookingId: booking.id, status: { in: ["PENDING", "PAID"] } } })) return null;
  const r = await createRequest(tx, ctx, { kind: "INSPECTION", description: `Inspection fee, booking ${booking.ref}`, amountKobo: s.inspectionFeeKobo, payerName: booking.requesterName, payerEmail: "", payerUserId: booking.requesterId, bookingId: booking.id });
  return r;
}

/** The company's payment requests and payments, newest first. */
export async function clientPayments(ctx: Ctx, f: { status?: string } = {}) {
  assertCan(ctx, "billing.view");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.clientPayment.findMany({ where: { companyId: ctx.companyId, ...(f.status ? { status: f.status } : {}) }, orderBy: { createdAt: "desc" }, take: 200 }));
}

/** A new link for a waiting payment (the first is shown only once, when it is made). */
export async function newPaymentLink(ctx: Ctx, ref: string) {
  assertCan(ctx, "payment.record");
  const token = randomBytes(24).toString("base64url");
  const n = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.clientPayment.updateMany({ where: { ref, companyId: ctx.companyId, status: "PENDING" }, data: { tokenHash: hashToken(token), checkoutUrl: "" } }));
  if (!n.count) throw new Error("Only a payment that is still waiting has a link.");
  return `/pay/${token}`;
}

export async function cancelPaymentRequest(ctx: Ctx, ref: string, reason: string) {
  assertCan(ctx, "payment.record");
  const text = z.string().trim().min(3, "Say why it is cancelled").max(300).parse(reason);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const n = await tx.clientPayment.updateMany({ where: { ref, companyId: ctx.companyId, status: "PENDING" }, data: { status: "CANCELLED", cancelReason: text, tokenHash: null } });
    if (!n.count) throw new Error("Only a payment that is still waiting can be cancelled.");
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client_payment", entityId: ref, action: "payments.cancelled", detail: { reason: text } });
  });
}

/**
 * The company confirms money for an inspection fee or other payment arrived by direct transfer. Housy's commission on it is
 * added to the company's next monthly commission invoice. (Rent received directly is recorded on the lease as usual.)
 */
export async function confirmTransfer(ctx: Ctx, ref: string, evidence: string) {
  assertCan(ctx, "payment.record");
  const ev = z.string().trim().min(3, "Record the transfer reference or other evidence").max(300).parse(evidence);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await tx.clientPayment.findFirst({ where: { ref, companyId: ctx.companyId } });
    if (!p || p.status !== "PENDING") throw new Error("Only a payment that is still waiting can be confirmed.");
    if (p.kind === "RENT") throw new Error("Record rent received directly on the lease (Record payment). The link is then closed for you.");
    await tx.clientPayment.update({ where: { id: p.id }, data: { status: "PAID", method: "TRANSFER", paidAt: new Date(), recordedById: ctx.userId, tokenHash: null, cancelReason: ev } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client_payment", entityId: p.id, action: "payments.transfer_confirmed", detail: { ref, evidence: ev } });
    if (p.payerUserId) await notify(tx, p.payerUserId, { kind: "payments.received", title: `Payment received: ${formatKobo(p.amountKobo, p.currency)}`, body: p.description, link: p.bookingId ? "/me/inspections" : "/me" });
  });
}

/**
 * Rent recorded on a lease as received directly (not through a Housy payment link): Housy's rent commission on it is noted for
 * the monthly commission invoice, and any waiting payment link for a charge it fully pays is closed. Runs in the recording
 * transaction.
 */
export async function noteRecordedRentIn(tx: Tx, ctx: Ctx, receipt: { id: string; leaseId: string; amountKobo: bigint; no: string }) {
  const bps = (await platformConfig()).commissionBps.RENT;
  const { currency } = await regionOf(tx, ctx.companyId);
  if (bps > 0) await tx.clientPayment.create({ data: {
    ref: clientPaymentRef(), companyId: ctx.companyId, kind: "RENT", description: `Rent recorded as received directly, receipt ${receipt.no}`,
    leaseId: receipt.leaseId, amountKobo: receipt.amountKobo, currency, commissionBps: bps, commissionKobo: commissionOf(receipt.amountKobo, bps),
    method: "TRANSFER", status: "PAID", paidAt: new Date(), receiptId: receipt.id, recordedById: ctx.userId, createdById: ctx.userId,
  } });
  const waiting = await tx.clientPayment.findMany({ where: { companyId: ctx.companyId, leaseId: receipt.leaseId, status: "PENDING", chargeId: { not: null } }, select: { id: true, chargeId: true } });
  for (const w of waiting) {
    const c = await tx.rentCharge.findFirst({ where: { id: w.chargeId!, companyId: ctx.companyId }, select: { amountKobo: true, adjustedKobo: true, paidKobo: true } });
    if (c && c.amountKobo + c.adjustedKobo - c.paidKobo <= 0n) await tx.clientPayment.update({ where: { id: w.id }, data: { status: "CANCELLED", cancelReason: "Paid another way", tokenHash: null } });
  }
}

// ---------- The payer's side (no sign-in: the link is the key) ----------

/** A signed-in person's payments for their inspections (fees asked for by companies). */
export async function myInspectionPayments(userId: string, bookingIds: string[]) {
  if (!bookingIds.length) return [];
  return withUser(userId, (tx) => tx.clientPayment.findMany({ where: { payerUserId: userId, bookingId: { in: bookingIds } }, orderBy: { createdAt: "desc" }, select: { ref: true, bookingId: true, amountKobo: true, currency: true, status: true, method: true, paidAt: true, description: true } }));
}

/** A fresh payment link for a signed-in person's own waiting payment (the link from the message is not kept). */
export async function myPaymentLink(userId: string, ref: string) {
  const mine = await withUser(userId, (tx) => tx.clientPayment.findFirst({ where: { ref, payerUserId: userId }, select: { id: true, status: true } }));
  if (!mine) throw new Error("Payment not found.");
  if (mine.status !== "PENDING") throw new Error(mine.status === "PAID" ? "This has already been paid." : "This payment request was cancelled.");
  const token = randomBytes(24).toString("base64url");
  await system((tx) => tx.clientPayment.update({ where: { id: mine.id }, data: { tokenHash: hashToken(token), checkoutUrl: "" } }));
  return `/pay/${token}`;
}

async function byToken(tx: Tx, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return tx.clientPayment.findUnique({ where: { tokenHash: hashToken(token) } });
}

/** What the payer sees: who is asking, for what, how much, and how to pay. Nothing else about the company or the lease. */
export async function paymentForPayer(token: string) {
  return system(async (tx) => {
    const p = await byToken(tx, token);
    if (!p) return null;
    const [company, settings] = await Promise.all([
      tx.company.findUnique({ where: { id: p.companyId }, select: { name: true, suspendedAt: true, country: true } }),
      tx.companyPaymentSettings.findUnique({ where: { companyId: p.companyId } }),
    ]);
    const provider = await onlineProviderFor(company?.country ?? "NG");
    const details = (settings?.bankDetails ?? null) as Record<string, string> | null;
    const lines = details ? bankLines(settings!.country, details) : settings?.accountNumber ? [{ label: "Bank", value: settings.bankName }, { label: "Account name", value: settings.accountName }, { label: "Account number", value: settings.accountNumber }] : [];
    return {
      ref: p.ref, kind: p.kind as ClientPaymentKind, description: p.description, amountKobo: p.amountKobo, currency: p.currency, status: p.status, paidAt: p.paidAt, payerName: p.payerName, payerEmail: p.payerEmail,
      company: company?.name ?? "", suspended: !!company?.suspendedAt,
      transfer: lines.length ? { lines, accountName: settings?.accountName ?? "", copy: settings?.accountNumber ?? "" } : null,
      online: provider === "PAYSTACK" ? !!settings?.paystackSubaccount : provider === "STRIPE" ? !!settings?.stripeReady : false,
      provider,
    };
  });
}

const payerSchema = z.object({ name: z.string().trim().min(2, "Enter your name").max(200), email: z.string().trim().toLowerCase().email("Enter your email address: the payment receipt goes there") });

/**
 * Start paying online, through the provider serving the company's country. Paystack splits the payment (Housy's share to Housy,
 * the rest to the company's bank); Stripe pays the company's Stripe account less Housy's share.
 */
export async function startOnlinePayment(token: string, raw: z.input<typeof payerSchema>, origin: string) {
  const d = payerSchema.parse(raw);
  const prep = await system(async (tx) => {
    const p = await byToken(tx, token);
    if (!p) throw new Error("This payment link is not valid any more. Ask for a new one.");
    await lockKey(tx, `client-payment:${p.id}`);
    if (p.status !== "PENDING") throw new Error(p.status === "PAID" ? "This has already been paid." : "This payment request was cancelled.");
    const [s, company] = await Promise.all([tx.companyPaymentSettings.findUnique({ where: { companyId: p.companyId } }), regionOf(tx, p.companyId)]);
    if (company.suspendedAt) throw new Error("This company cannot take payments through Housy just now.");
    const provider = await onlineProviderFor(company.country);
    if (provider === "PAYSTACK" && !s?.paystackSubaccount) throw new Error("This company takes bank transfers only. Use the details on this page.");
    if (provider === "STRIPE" && !(s?.stripeAccount && s.stripeReady)) throw new Error("This company takes bank transfers only. Use the details on this page.");
    if (!provider) throw new Error("Online payment is not available just now. Pay by bank transfer using the details on this page.");
    const attempts = await tx.activityLog.count({ where: { entityType: "client_payment", entityId: p.id, action: "payments.online_started" } });
    await tx.clientPayment.update({ where: { id: p.id }, data: { payerName: d.name, payerEmail: d.email, provider } });
    await logActivity(tx, { companyId: p.companyId, actorId: SYSTEM, entityType: "client_payment", entityId: p.id, action: "payments.online_started", detail: { attempt: attempts + 1, provider } });
    return { p, provider, subaccount: s!.paystackSubaccount, stripeAccount: s!.stripeAccount, reference: `${p.ref}-${attempts + 1}` };
  });
  const callbackUrl = `${origin}/pay/${token}?checked=1`;
  let r: { ok: true; checkoutUrl: string } | { ok: false; error: string };
  if (prep.provider === "PAYSTACK") {
    const api = await splitApi();
    if (!api) throw new Error("Online payment is not available just now. Pay by bank transfer using the details on this page.");
    r = await api.initializeSplit({ reference: prep.reference, amountKobo: prep.p.amountKobo, currency: prep.p.currency, email: d.email, callbackUrl, subaccount: prep.subaccount, housyShareKobo: prep.p.commissionKobo, metadata: { payment: prep.p.ref, kind: prep.p.kind } });
  } else {
    const api = await stripeApi();
    if (!api) throw new Error("Online payment is not available just now. Pay by bank transfer using the details on this page.");
    r = await api.initializeDestination({ reference: prep.reference, amountMinor: prep.p.amountKobo, currency: prep.p.currency, email: d.email, callbackUrl, account: prep.stripeAccount, housyShareMinor: prep.p.commissionKobo, description: prep.p.description });
  }
  if (!r.ok) throw new Error("The payment page could not be opened just now. Try again, or pay by bank transfer.");
  const url = r.checkoutUrl;
  await system((tx) => tx.clientPayment.update({ where: { id: prep.p.id }, data: { checkoutUrl: url } }));
  return url;
}

/** Back from checkout: ask the provider what happened (never trust the browser), and settle it if it was paid. */
export async function checkOnlinePayment(token: string) {
  const p = await system((tx) => byToken(tx, token));
  if (!p || p.status !== "PENDING") return p?.status ?? null;
  const provider = await paymentProviderNamed(p.provider === "STRIPE" ? "STRIPE" : "PAYSTACK");
  if (!provider) return p.status;
  const attempts = await system((tx) => tx.activityLog.count({ where: { entityType: "client_payment", entityId: p.id, action: "payments.online_started" } }));
  for (let n = attempts; n >= 1 && n > attempts - 3; n--) {
    const v = await provider.verify(`${p.ref}-${n}`);
    if (v.ok && v.status === "success") { await system((tx) => settleClientPaymentIn(tx, `${p.ref}-${n}`, v.amountKobo, v.providerTxId, new Date(), v.currency)); break; }
  }
  return (await system((tx) => tx.clientPayment.findUnique({ where: { id: p.id }, select: { status: true } })))?.status ?? null;
}

/**
 * Settle an online payment once, from the provider's message or a check after checkout. The amount and currency must be exactly
 * what was asked.
 * Rent paid online is receipted on the lease automatically; Housy's commission (sent to Housy by the split) is booked as revenue.
 */
export async function settleClientPaymentIn(tx: Tx, reference: string, receivedKobo: bigint, providerTxId: string, now: Date, receivedCurrency?: string): Promise<string> {
  const ref = reference.split("-").slice(0, 2).join("-");
  if (!isClientPaymentRef(ref)) return "UNKNOWN_REFERENCE";
  const p = await tx.clientPayment.findUnique({ where: { ref } });
  if (!p) return "UNKNOWN_REFERENCE";
  await lockKey(tx, `client-payment:${p.id}`);
  const fresh = await tx.clientPayment.findUniqueOrThrow({ where: { id: p.id } });
  if (fresh.status === "PAID") return "ALREADY";
  const wrongCurrency = !!receivedCurrency && receivedCurrency.toUpperCase() !== fresh.currency;
  if (receivedKobo !== fresh.amountKobo || wrongCurrency) {
    await logActivity(tx, { companyId: p.companyId, actorId: SYSTEM, entityType: "client_payment", entityId: p.id, action: "payments.amount_mismatch", detail: { expected: fresh.amountKobo.toString(), received: receivedKobo.toString(), currency: fresh.currency, receivedCurrency: receivedCurrency ?? "", providerTxId } });
    for (const a of await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 20 })) await notify(tx, a.id, { kind: "payments.mismatch", title: `Online payment ${ref} does not match`, body: `Expected ${formatKobo(fresh.amountKobo, fresh.currency)}, received ${formatKobo(receivedKobo, wrongCurrency ? receivedCurrency : fresh.currency)}. Look into it.`, link: "/admin/payments" });
    return "AMOUNT_MISMATCH";
  }
  let receiptId: string | null = null;
  if (fresh.kind === "RENT" && fresh.leaseId) {
    // The receipt is issued in the company's records, for what is still owed on the charge.
    const ctx: Ctx = { companyId: p.companyId, userId: SYSTEM, membershipId: "", role: "COMPANY_SUPER_ADMIN" };
    const via = fresh.provider === "STRIPE" ? "Stripe" : "Paystack";
    // Lease records are the company's own (row-level security): act inside the company for this part, as the system.
    await tx.$queryRaw`SELECT set_config('app.company_id', ${p.companyId}, true)`;
    await tx.$queryRaw`SELECT id FROM rent_charges WHERE lease_id = ${fresh.leaseId} AND company_id = ${p.companyId} ORDER BY id FOR UPDATE`;
    const charges = await tx.rentCharge.findMany({ where: { leaseId: fresh.leaseId, companyId: p.companyId }, select: { id: true, amountKobo: true, adjustedKobo: true, paidKobo: true } });
    const left = (c: { amountKobo: bigint; adjustedKobo: bigint; paidKobo: bigint }) => c.amountKobo + c.adjustedKobo - c.paidKobo;
    const owedAll = charges.reduce((n, c) => n + (left(c) > 0n ? left(c) : 0n), 0n);
    const charge = charges.find((c) => c.id === fresh.chargeId);
    if (owedAll >= fresh.amountKobo) {
      const onCharge = charge && left(charge) >= fresh.amountKobo ? charge.id : null;
      const receipt = await postReceiptIn(tx, ctx, fresh.leaseId, { amount: fresh.amountKobo, paidOn: todayInLagos(now), evidence: `${via} ${providerTxId || reference}`, method: `Online (${via})`, payerName: fresh.payerName }, onCharge);
      receiptId = receipt.id;
    } else {
      // The rent was meanwhile paid another way: the money is the company's, but a person decides what it pays for (or refunds it).
      await logActivity(tx, { companyId: p.companyId, actorId: SYSTEM, entityType: "client_payment", entityId: p.id, action: "payments.receipt_needed", detail: { ref, owedKobo: owedAll.toString() } });
    }
    await tx.$queryRaw`SELECT set_config('app.company_id', '', true)`;
  }
  await tx.clientPayment.update({ where: { id: p.id }, data: { status: "PAID", method: "ONLINE", paidAt: now, receiptId, tokenHash: null } });
  if (fresh.commissionKobo > 0n) await post(tx, { ledger: "COMMISSION", kind: "PAYMENT", account: "REVENUE", amountKobo: fresh.commissionKobo, currency: fresh.currency, entryKey: `cp:${p.id}`, actorId: fresh.provider === "STRIPE" ? "system:stripe" : "system:paystack", note: `Commission on ${ref} (online)` });
  await logActivity(tx, { companyId: p.companyId, actorId: SYSTEM, entityType: "client_payment", entityId: p.id, action: "payments.paid_online", detail: { ref, amountKobo: fresh.amountKobo.toString(), commissionKobo: fresh.commissionKobo.toString(), providerTxId } });
  const managers = await tx.membership.findMany({ where: { companyId: p.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] } }, select: { userId: true } });
  for (const m of managers) await notify(tx, m.userId, { kind: "payments.received", title: `${formatKobo(fresh.amountKobo, fresh.currency)} paid online`, body: `${fresh.description}${fresh.payerName ? ` · ${fresh.payerName}` : ""}. It settles to your bank through ${fresh.provider === "STRIPE" ? "Stripe" : "Paystack"}, less Housy's commission and the provider's fee.${fresh.kind === "RENT" && !receiptId ? " The rent was already paid, so no receipt was issued: decide what this payment covers, or refund it." : ""}`, link: "/app/payments" });
  if (fresh.payerUserId) await notify(tx, fresh.payerUserId, { kind: "payments.received", title: `Payment received: ${formatKobo(fresh.amountKobo, fresh.currency)}`, body: fresh.description, link: fresh.bookingId ? "/me/inspections" : "/me" });
  return "SETTLED";
}

// ---------- Housy's monthly commission invoices ----------

/**
 * On the first days of each month, invoice each company Housy's commission on last month's direct transfers and recorded rent.
 * Runs on the schedule; safe to run again (each payment is invoiced once).
 */
export async function invoiceCommissions(now = new Date()) {
  const { from, to, label } = previousMonth(now);
  const due = await system((tx) => tx.clientPayment.groupBy({ by: ["companyId", "currency"], where: { method: "TRANSFER", status: "PAID", commissionKobo: { gt: 0n }, commissionInvoiceId: null, paidAt: { gte: from, lt: to } }, _sum: { commissionKobo: true } }));
  let made = 0;
  for (const g of due) {
    await system(async (tx) => {
      await lockKey(tx, `commission-invoice:${g.companyId}`);
      const rows = await tx.clientPayment.findMany({ where: { companyId: g.companyId, currency: g.currency, method: "TRANSFER", status: "PAID", commissionKobo: { gt: 0n }, commissionInvoiceId: null, paidAt: { gte: from, lt: to } }, select: { id: true, commissionKobo: true } });
      const total = rows.reduce((n, r) => n + r.commissionKobo, 0n);
      if (total <= 0n) return;
      const company = await tx.company.findUniqueOrThrow({ where: { id: g.companyId }, select: { name: true } });
      const inv = await tx.invoice.create({ data: { ref: randomRef("INV"), purpose: "COMMISSION", ownerKind: "COMPANY", ownerCompanyId: g.companyId, ownerName: company.name, subjectId: g.companyId, description: `Housy commission for ${label} (${rows.length} payment${rows.length === 1 ? "" : "s"} received directly)`, amountKobo: total, currency: g.currency, dueOn: new Date(now.getTime() + 14 * 86_400_000), createdById: SYSTEM } });
      await tx.clientPayment.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { commissionInvoiceId: inv.id } });
      await logActivity(tx, { companyId: g.companyId, actorId: SYSTEM, entityType: "invoice", entityId: inv.id, action: "invoice.created", detail: { ref: inv.ref, purpose: "COMMISSION", month: label } });
      const admins = await tx.membership.findMany({ where: { companyId: g.companyId, status: "ACTIVE", role: "COMPANY_SUPER_ADMIN" }, select: { userId: true } });
      for (const a of admins) await notify(tx, a.userId, { kind: "billing.invoice", title: `Housy commission for ${label}: ${formatKobo(total, g.currency)}`, body: "On rent and fees you recorded as received directly. Pay it from Billing.", link: `/app/billing/${inv.id}`, email: true });
      made++;
    });
  }
  return made;
}
