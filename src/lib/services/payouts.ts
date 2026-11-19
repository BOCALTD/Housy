/**
 * Paying contractors and suppliers.
 *
 * One person asks for a payment (who, how much, why, and the work order if there is one). A different person approves it, and
 * the database refuses an approval by the person who asked. Approved payments are sent:
 *  - PAYSTACK: a transfer from the company's own Paystack balance to the payee's bank account (checked with the bank first and
 *    saved as a Paystack recipient). The company enters its own Paystack secret key in Settings, Payouts, and points Paystack's
 *    webhook at its private payout address; Housy also checks pending transfers itself. The same reference is always used, so a
 *    retry can never send twice.
 *  - STRIPE: the payee sets up their own Stripe account (a link the company sends them); the approver pays by card on Stripe's page
 *    and Stripe passes the money to the payee's account.
 *  - BANK: the approver pays from the company's bank and records the bank's reference here.
 * Every step is kept (contractor_payout_events), and each paid payout appears in the accounting export.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withPlatformAdmin, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { lockKey } from "../locks";
import { formatKobo } from "../money";
import { parseMoney, PAYSTACK_COUNTRIES, isCountry, STRIPE_COUNTRIES, type Country } from "../regions";
import { hmacSha512 } from "../billing-rules";
import { openSecret, sealSecret } from "../totp";
import { todayInLagos, parseDateOnly } from "../dates";
import { paystackTransferApi, parseTransferEvent, recipientTypeFor, stripeConnectApi, type Bank, type TransferApi, type TransferStatus } from "../payment-providers";
import { platformConfig } from "./platform-config";
import { notify } from "./notifications";
import { assertCan, type Ctx } from "./context";

const SYSTEM = "system";
type Status = "REQUESTED" | "APPROVED" | "SENDING" | "PAID" | "FAILED" | "REJECTED" | "CANCELLED" | "REVERSED";
type Method = "PAYSTACK" | "STRIPE" | "BANK";

/** For tests: a stand-in for Paystack. */
let transferOverride: ((secret: string) => TransferApi) | null = null;
export function _useTransferApi(f: ((secret: string) => TransferApi) | null) { transferOverride = f; }
const transferApi = (secret: string) => (transferOverride ? transferOverride(secret) : paystackTransferApi(secret));

const open = (v: string | null | undefined) => { if (!v) return ""; try { return openSecret(v); } catch { return ""; } };

async function company(tx: Tx, companyId: string) {
  return tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, name: true, country: true, currency: true, payoutPaystackKey: true, payoutWebhookToken: true, contactEmail: true } });
}

async function companyApi(companyId: string) {
  const c = await withTenant(companyId, SYSTEM, (tx) => company(tx, companyId));
  const key = open(c.payoutPaystackKey);
  return key ? { api: transferApi(key), company: c } : null;
}

async function event(tx: Tx, p: { id: string; companyId: string }, kind: string, from: Status | null, to: Status | null, actorId: string, note = "") {
  await tx.contractorPayoutEvent.create({ data: { companyId: p.companyId, payoutId: p.id, kind, fromStatus: from, toStatus: to, note: note.slice(0, 500), actorId } });
}

// ---------- Settings: the company's own Paystack ----------

export async function payoutSettings(ctx: Ctx) {
  assertCan(ctx, "payout.request");
  const c = await withTenant(ctx.companyId, ctx.userId, (tx) => company(tx, ctx.companyId));
  const key = open(c.payoutPaystackKey);
  const paystackCountry = isCountry(c.country) && !!PAYSTACK_COUNTRIES[c.country];
  const stripe = (await platformConfig()).stripe.secret !== "" && isCountry(c.country) && STRIPE_COUNTRIES.includes(c.country as Country);
  return {
    paystack: !!key, keyTail: key ? `…${key.slice(-4)}` : "", test: key.startsWith("sk_test_"), paystackCountry, stripe,
    webhookPath: c.payoutWebhookToken ? `/api/webhooks/payouts/${c.payoutWebhookToken}` : "", currency: c.currency, country: c.country,
  };
}

/** Save the company's Paystack secret key after checking it with Paystack. An empty key disconnects. */
export async function savePayoutKey(ctx: Ctx, keyRaw: string) {
  assertCan(ctx, "settings.manage");
  const key = keyRaw.trim();
  const c = await withTenant(ctx.companyId, ctx.userId, (tx) => company(tx, ctx.companyId));
  if (key && !/^sk_(live|test)_[A-Za-z0-9]{20,}$/.test(key)) throw new Error("Paste the secret key from Paystack (it starts with sk_live_ or sk_test_)");
  if (key) {
    const b = await transferApi(key).balance(c.currency);
    if (!b.ok) throw new Error(`${b.error}. Check the key in your Paystack dashboard (Settings, API Keys and Webhooks).`);
  }
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { payoutPaystackKey: key ? sealSecret(key) : null, payoutWebhookToken: c.payoutWebhookToken ?? randomBytes(18).toString("base64url") } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: key ? "payouts.paystack_connected" : "payouts.paystack_disconnected", detail: { test: key.startsWith("sk_test_") } });
  });
}

const bankCache = new Map<string, { at: number; banks: Bank[] }>();
/** Banks for the company's country, from Paystack (empty until its key is saved). */
export async function payoutBanks(ctx: Ctx): Promise<Bank[]> {
  const a = await companyApi(ctx.companyId);
  if (!a || !isCountry(a.company.country)) return [];
  const where = PAYSTACK_COUNTRIES[a.company.country];
  if (!where) return [];
  const hit = bankCache.get(ctx.companyId);
  if (hit && Date.now() - hit.at < 86_400_000 && hit.banks.length) return hit.banks;
  const list = await a.api.banks(where.bankListCountry, where.currency).catch(() => []);
  if (list.length) bankCache.set(ctx.companyId, { at: Date.now(), banks: list });
  return list;
}

// ---------- Payees ----------

/**
 * Save where a contractor is paid. With the company's Paystack connected, the account is checked with the bank (the name the bank
 * holds is shown and kept) and saved as a Paystack recipient. Without it, the details are kept for bank transfers as typed.
 */
export async function savePayee(ctx: Ctx, contractorId: string, raw: { bankCode?: string; bankName?: string; accountNumber: string; accountName?: string }) {
  assertCan(ctx, "payout.approve");
  const accountNumber = raw.accountNumber.replace(/\s+/g, "");
  if (!/^[0-9A-Za-z]{6,34}$/.test(accountNumber)) throw new Error("Enter the account number (digits only for Nigerian banks)");
  const a = await companyApi(ctx.companyId);
  let data: { bankCode: string; bankName: string; accountNumber: string; accountName: string; paystackRecipient: string };
  if (a) {
    const banks = await payoutBanks(ctx);
    const bank = banks.find((b) => b.code === raw.bankCode);
    if (!bank) throw new Error("Choose the bank");
    if (a.company.currency === "NGN" && !/^\d{10}$/.test(accountNumber)) throw new Error("A Nigerian account number has 10 digits");
    const r = await a.api.resolveAccount(accountNumber, bank.code);
    if (!r.ok) throw new Error(r.error);
    const rec = await a.api.createRecipient({ name: r.accountName, accountNumber, bankCode: bank.code, currency: a.company.currency, type: recipientTypeFor(a.company.currency) });
    if (!rec.ok) throw new Error(`Paystack did not save the account: ${rec.error}`);
    data = { bankCode: bank.code, bankName: bank.name, accountNumber, accountName: r.accountName, paystackRecipient: rec.code };
  } else {
    const bankName = (raw.bankName ?? "").trim(), accountName = (raw.accountName ?? "").trim();
    if (bankName.length < 2) throw new Error("Enter the bank's name");
    if (accountName.length < 2) throw new Error("Enter the account name exactly as the bank has it");
    data = { bankCode: "", bankName: bankName.slice(0, 120), accountNumber, accountName: accountName.slice(0, 200), paystackRecipient: "" };
  }
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.contractor.findFirst({ where: { id: contractorId, companyId: ctx.companyId }, select: { id: true, name: true } });
    if (!c) throw new Error("Contractor not found");
    // A changed account never applies to payments already waiting: they are sent to what was approved, so ask again.
    const waiting = await tx.contractorPayout.count({ where: { companyId: ctx.companyId, contractorId, status: { in: ["REQUESTED", "APPROVED", "SENDING"] } } });
    if (waiting) throw new Error(`${c.name} has ${waiting} payment${waiting === 1 ? "" : "s"} waiting. Finish or cancel ${waiting === 1 ? "it" : "them"} before changing the account.`);
    await tx.contractor.update({ where: { id: contractorId }, data });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "contractor", entityId: contractorId, action: "payouts.payee_saved", detail: { bank: data.bankName, last4: accountNumber.slice(-4), checked: !!a } });
    return data;
  });
}

/** Start (or continue) a contractor's own Stripe account set-up; returns the link to send them. */
export async function stripePayeeLink(ctx: Ctx, contractorId: string, email: string, origin: string) {
  assertCan(ctx, "payout.approve");
  const cfg = await platformConfig();
  if (!cfg.stripe.secret) throw new Error("Stripe is not connected on this platform");
  const api = stripeConnectApi(cfg.stripe.secret);
  const { c, co } = await withTenant(ctx.companyId, ctx.userId, async (tx) => ({
    c: await tx.contractor.findFirst({ where: { id: contractorId, companyId: ctx.companyId } }),
    co: await company(tx, ctx.companyId),
  }));
  if (!c) throw new Error("Contractor not found");
  if (!STRIPE_COUNTRIES.includes(co.country as Country)) throw new Error("Stripe payouts are for companies in the countries Stripe serves");
  let account = c.stripeAccountId;
  if (!account) {
    const e = (email || c.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Enter the contractor's email address");
    const r = await api.createAccount({ country: co.country, email: e, businessName: c.name });
    if (!r.ok) throw new Error(`Stripe did not create the account: ${r.error}`);
    account = r.id;
    await withTenant(ctx.companyId, ctx.userId, (tx) => tx.contractor.update({ where: { id: contractorId }, data: { stripeAccountId: account, ...(c.email ? {} : { email: e }) } }));
  }
  const link = await api.onboardingLink(account, `${origin}/app/payouts`);
  if (!link.ok) throw new Error(link.error);
  return link.url;
}

/** Ask Stripe whether the contractor has finished setting up. */
export async function refreshStripePayee(ctx: Ctx, contractorId: string) {
  assertCan(ctx, "payout.request");
  const cfg = await platformConfig();
  if (!cfg.stripe.secret) return false;
  const c = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.contractor.findFirst({ where: { id: contractorId, companyId: ctx.companyId }, select: { stripeAccountId: true } }));
  if (!c?.stripeAccountId) return false;
  const ready = await stripeConnectApi(cfg.stripe.secret).accountReady(c.stripeAccountId);
  await withTenant(ctx.companyId, ctx.userId, (tx) => tx.contractor.update({ where: { id: contractorId }, data: { stripeReady: ready } }));
  return ready;
}

// ---------- Asking, deciding, sending ----------

const requestSchema = z.object({
  contractorId: z.string().uuid("Choose who is being paid"),
  amount: z.string().trim().min(1, "Enter the amount"),
  method: z.enum(["PAYSTACK", "STRIPE", "BANK"], { error: "Choose how it is paid" }),
  reason: z.string().trim().min(3, "Say what the payment is for").max(300),
  workOrderId: z.string().uuid().optional().or(z.literal("")),
});

export async function requestPayout(ctx: Ctx, raw: z.input<typeof requestSchema>) {
  assertCan(ctx, "payout.request");
  const d = requestSchema.parse(raw);
  const settings = await payoutSettings(ctx);
  const amount = parseMoney(d.amount, settings.currency);
  if (amount <= 0n) throw new Error("Enter an amount above zero");
  if (amount > 100_000_000_000n) throw new Error("That amount is too large for one payment");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.contractor.findFirst({ where: { id: d.contractorId, companyId: ctx.companyId } });
    if (!c || !c.active) throw new Error("Choose an active contractor");
    if (d.method === "PAYSTACK") {
      if (!settings.paystack) throw new Error("Connect your company's Paystack in Settings, Payouts first, or pay by bank transfer");
      if (!c.paystackRecipient) throw new Error(`Add ${c.name}'s bank account (checked with the bank) before paying through Paystack`);
    }
    if (d.method === "STRIPE" && !(settings.stripe && c.stripeAccountId && c.stripeReady)) throw new Error(`${c.name} has not finished setting up Stripe yet`);
    if (d.method === "BANK" && !c.accountNumber) throw new Error(`Add ${c.name}'s bank account first`);
    let workOrderId: string | null = null, assetId: string | null = null;
    if (d.workOrderId) {
      const wo = await tx.workOrder.findFirst({ where: { id: d.workOrderId, companyId: ctx.companyId }, select: { id: true, ref: true, assetId: true, status: true, contractorId: true, actualCostKobo: true, approvedCostKobo: true } });
      if (!wo) throw new Error("Choose one of your company's work orders");
      if (wo.status === "CANCELLED") throw new Error(`Work order ${wo.ref} was cancelled`);
      const cap = wo.actualCostKobo ?? wo.approvedCostKobo;
      if (cap != null) {
        const already = await tx.contractorPayout.aggregate({ where: { companyId: ctx.companyId, workOrderId: wo.id, status: { in: ["REQUESTED", "APPROVED", "SENDING", "PAID"] } }, _sum: { amountKobo: true } });
        const left = cap - (already._sum.amountKobo ?? 0n);
        if (amount > left) throw new Error(`That is more than is left to pay on work order ${wo.ref} (${formatKobo(left > 0n ? left : 0n, settings.currency)} of its ${wo.actualCostKobo != null ? "actual" : "approved"} cost)`);
      }
      workOrderId = wo.id; assetId = wo.assetId;
    }
    const year = todayInLagos().getUTCFullYear();
    const ref = `PO-${year}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const p = await tx.contractorPayout.create({ data: {
      companyId: ctx.companyId, ref, contractorId: c.id, workOrderId, assetId, amountKobo: amount, currency: settings.currency, method: d.method, reason: d.reason,
      requestedById: ctx.userId, providerRef: d.method === "PAYSTACK" ? `housy-po-${randomUUID()}` : d.method === "STRIPE" ? ref : "",
    } });
    await event(tx, p, "requested", null, "REQUESTED", ctx.userId, d.reason);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "contractor_payout", entityId: p.id, action: "payouts.requested", detail: { ref, amountKobo: amount.toString(), method: d.method, contractor: c.name } });
    const approvers = await tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] }, userId: { not: ctx.userId } }, select: { userId: true }, take: 20 });
    for (const m of approvers) await notify(tx, m.userId, { kind: "payouts.requested", title: `Payment to approve: ${formatKobo(amount, settings.currency)} to ${c.name}`, body: d.reason.slice(0, 120), link: "/app/payouts", dedupeKey: `po-req:${p.id}:${m.userId}` });
    return p;
  });
}

async function locked(tx: Tx, companyId: string, id: string) {
  await lockKey(tx, `payout:${id}`);
  const p = await tx.contractorPayout.findFirst({ where: { id, companyId }, include: { contractor: true } });
  if (!p) throw new Error("Payment not found");
  return p;
}

/** Approve (and send) or reject a payment. The person who asked cannot decide it. */
export async function decidePayout(ctx: Ctx, id: string, decision: "approve" | "reject", note = "", origin = "") {
  assertCan(ctx, "payout.approve");
  const p = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await locked(tx, ctx.companyId, id);
    if (p.status !== "REQUESTED") throw new Error("This payment has already been decided");
    if (p.requestedById === ctx.userId) throw new Error("Another person must approve a payment you asked for");
    if (decision === "reject") {
      if (note.trim().length < 3) throw new Error("Say why the payment is rejected");
      await tx.contractorPayout.update({ where: { id }, data: { status: "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note.trim().slice(0, 300) } });
      await event(tx, p, "rejected", "REQUESTED", "REJECTED", ctx.userId, note);
      await notify(tx, p.requestedById, { kind: "payouts.rejected", title: `Payment ${p.ref} was not approved`, body: note.slice(0, 120), link: "/app/payouts" });
      return { ...p, status: "REJECTED" as Status };
    }
    // The payee's details must still be what the request was made against.
    if (p.method === "PAYSTACK" && !p.contractor.paystackRecipient) throw new Error("The contractor's bank account is missing. Add it, then ask again.");
    const next: Status = p.method === "PAYSTACK" ? "SENDING" : "APPROVED";
    await tx.contractorPayout.update({ where: { id }, data: { status: next, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note.trim().slice(0, 300) } });
    await event(tx, p, "approved", "REQUESTED", next, ctx.userId, note);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "contractor_payout", entityId: id, action: "payouts.approved", detail: { ref: p.ref, method: p.method } });
    return { ...p, status: next };
  });
  if (decision === "approve" && p.method === "PAYSTACK") return sendPaystack(ctx.companyId, id, ctx.userId);
  if (decision === "approve" && p.method === "STRIPE") return startStripe(ctx, id, origin);
  return p.status;
}

/** Send (or safely re-send) a Paystack transfer, and record what Paystack says. */
async function sendPaystack(companyId: string, id: string, actorId: string): Promise<Status> {
  const a = await companyApi(companyId);
  const p = await withTenant(companyId, SYSTEM, (tx) => tx.contractorPayout.findFirstOrThrow({ where: { id, companyId }, include: { contractor: true } }));
  if (p.status !== "SENDING") return p.status as Status;
  if (!a) return fail(companyId, id, "Your company's Paystack is not connected any more. Connect it in Settings, Payouts.", actorId);
  // Already sent with this reference (a retry after a lost answer)? Then only record its outcome.
  const v = await a.api.verify(p.providerRef);
  if (v.ok && v.status !== "unknown") return applyTransfer(companyId, p.providerRef, v.status, v.amountMinor, v.reason, actorId);
  const t = await a.api.transfer({ amountMinor: p.amountKobo, recipient: p.contractor.paystackRecipient, reference: p.providerRef, reason: `${p.ref} ${p.reason}`.slice(0, 100), currency: p.currency });
  if (!t.ok) {
    if (t.permanent) return fail(companyId, id, `Paystack refused the transfer: ${t.error}`, actorId);
    const tries = await withTenant(companyId, SYSTEM, (tx) => tx.contractorPayoutEvent.count({ where: { payoutId: id, kind: "send_retry" } }));
    if (tries >= 12) return fail(companyId, id, "Paystack did not answer after many tries. Check your Paystack dashboard before asking again.", actorId);
    await withTenant(companyId, SYSTEM, (tx) => event(tx, p, "send_retry", "SENDING", "SENDING", actorId, t.error));
    return "SENDING";
  }
  await withTenant(companyId, SYSTEM, (tx) => tx.contractorPayout.update({ where: { id }, data: { transferCode: t.transferCode } }));
  if (t.status === "otp") return fail(companyId, id, "Paystack asked for a one-time code. Turn off the OTP requirement for transfers in your Paystack dashboard (Settings, Preferences), then ask for the payment again.", actorId);
  return applyTransfer(companyId, p.providerRef, t.status, p.amountKobo, "", actorId);
}

async function fail(companyId: string, id: string, reason: string, actorId: string): Promise<Status> {
  await withTenant(companyId, SYSTEM, async (tx) => {
    const p = await locked(tx, companyId, id);
    if (p.status !== "SENDING" && p.status !== "APPROVED") return;
    await tx.contractorPayout.update({ where: { id }, data: { status: "FAILED", failedReason: reason.slice(0, 300) } });
    await event(tx, p, "failed", p.status as Status, "FAILED", actorId, reason);
    for (const u of new Set([p.requestedById, p.decidedById].filter((x): x is string => !!x))) await notify(tx, u, { kind: "payouts.failed", title: `Payment ${p.ref} did not go through`, body: reason.slice(0, 160), link: "/app/payouts" });
  });
  return "FAILED";
}

/** Record Paystack's answer about a transfer (from sending, a webhook, or a check). Applied once per outcome. */
async function applyTransfer(companyId: string, reference: string, status: TransferStatus, amountMinor: bigint, reason: string, actorId: string): Promise<Status> {
  return withTenant(companyId, SYSTEM, async (tx) => {
    const found = await tx.contractorPayout.findFirst({ where: { companyId, providerRef: reference }, select: { id: true } });
    if (!found) return "FAILED" as Status;
    const p = await locked(tx, companyId, found.id);
    const cur = p.status as Status;
    if (status === "success" && cur === "SENDING") {
      if (amountMinor && amountMinor !== p.amountKobo) {
        await event(tx, p, "amount_mismatch", cur, cur, actorId, `Paystack reported ${amountMinor} for ${p.amountKobo}`);
        return cur;
      }
      await tx.contractorPayout.update({ where: { id: p.id }, data: { status: "PAID", paidAt: new Date(), paidOn: todayInLagos() } });
      await event(tx, p, "paid", cur, "PAID", actorId, "Paystack confirmed the transfer");
      await logActivity(tx, { companyId, actorId: null, entityType: "contractor_payout", entityId: p.id, action: "payouts.paid", detail: { ref: p.ref, via: "PAYSTACK" } });
      await notify(tx, p.requestedById, { kind: "payouts.paid", title: `${formatKobo(p.amountKobo, p.currency)} paid to ${p.contractor.name}`, body: p.ref, link: "/app/payouts" });
      return "PAID";
    }
    if ((status === "failed" && (cur === "SENDING")) || (status === "reversed" && (cur === "SENDING" || cur === "PAID"))) {
      const to: Status = status === "reversed" ? "REVERSED" : "FAILED";
      const why = reason || (status === "reversed" ? "The bank returned the money" : "Paystack could not complete the transfer");
      await tx.contractorPayout.update({ where: { id: p.id }, data: { status: to, failedReason: why.slice(0, 300) } });
      await event(tx, p, status, cur, to, actorId, why);
      for (const u of new Set([p.requestedById, p.decidedById].filter((x): x is string => !!x))) await notify(tx, u, { kind: "payouts.failed", title: `Payment ${p.ref} ${to === "REVERSED" ? "came back" : "did not go through"}`, body: why.slice(0, 160), link: "/app/payouts" });
      return to;
    }
    return cur;
  });
}

async function startStripe(ctx: Ctx, id: string, origin: string): Promise<Status> {
  const cfg = await platformConfig();
  const p = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.contractorPayout.findFirstOrThrow({ where: { id, companyId: ctx.companyId }, include: { contractor: true } }));
  if (!cfg.stripe.secret) return fail(ctx.companyId, id, "Stripe is not connected on this platform", ctx.userId);
  const me = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }));
  const r = await stripeConnectApi(cfg.stripe.secret).initializeDestination({
    reference: p.ref, amountMinor: p.amountKobo, currency: p.currency, email: me?.email ?? "", callbackUrl: `${origin}/app/payouts`, account: p.contractor.stripeAccountId, housyShareMinor: 0n, description: `${p.ref} to ${p.contractor.name}: ${p.reason}`,
  });
  if (!r.ok) return fail(ctx.companyId, id, r.error, ctx.userId);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.contractorPayout.update({ where: { id }, data: { checkoutUrl: r.checkoutUrl } });
    await event(tx, p, "stripe_checkout", "APPROVED", "APPROVED", ctx.userId, "Stripe payment page opened");
  });
  return "APPROVED";
}

/** Stripe reported that the approver paid (checkout completed): the money goes to the contractor's Stripe account. */
export async function settleContractorPayoutIn(tx: Tx, ref: string, amountMinor: bigint, currency: string | undefined) {
  const head = await tx.$queryRaw<{ id: string; company_id: string }[]>`SELECT id, company_id FROM contractor_payouts WHERE ref = ${ref} AND method = 'STRIPE' LIMIT 1`;
  if (!head.length) return "UNKNOWN_REFERENCE";
  const companyId = head[0].company_id;
  await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
  const p = await locked(tx, companyId, head[0].id);
  if (p.status === "PAID") return "ALREADY";
  if (p.status !== "APPROVED") return "IGNORED";
  if (amountMinor !== p.amountKobo || (currency && currency.toUpperCase() !== p.currency)) {
    await event(tx, p, "amount_mismatch", "APPROVED", "APPROVED", SYSTEM, `Stripe reported ${amountMinor} ${currency ?? ""}`);
    return "AMOUNT_MISMATCH";
  }
  await tx.contractorPayout.update({ where: { id: p.id }, data: { status: "PAID", paidAt: new Date(), paidOn: todayInLagos(), checkoutUrl: "" } });
  await event(tx, p, "paid", "APPROVED", "PAID", SYSTEM, "Paid through Stripe");
  await logActivity(tx, { companyId, actorId: null, entityType: "contractor_payout", entityId: p.id, action: "payouts.paid", detail: { ref: p.ref, via: "STRIPE" } });
  await notify(tx, p.requestedById, { kind: "payouts.paid", title: `${formatKobo(p.amountKobo, p.currency)} paid to ${p.contractor.name}`, body: p.ref, link: "/app/payouts" });
  return "SETTLED";
}

/** The approver paid from the company's bank: record the bank's reference. */
export async function recordBankPayout(ctx: Ctx, id: string, raw: { bankReference: string; paidOn: string }) {
  assertCan(ctx, "payout.approve");
  const ref = raw.bankReference.trim();
  if (ref.length < 4) throw new Error("Enter the bank's reference for the transfer");
  const paidOn = parseDateOnly(raw.paidOn);
  if (paidOn > todayInLagos()) throw new Error("The payment date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await locked(tx, ctx.companyId, id);
    if (p.method !== "BANK" || p.status !== "APPROVED") throw new Error("This payment is not waiting to be recorded");
    await tx.contractorPayout.update({ where: { id }, data: { status: "PAID", bankReference: ref.slice(0, 100), paidOn, paidAt: new Date() } });
    await event(tx, p, "paid", "APPROVED", "PAID", ctx.userId, `Bank reference ${ref}`);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "contractor_payout", entityId: id, action: "payouts.paid", detail: { ref: p.ref, via: "BANK", bankReference: ref } });
    if (p.requestedById !== ctx.userId) await notify(tx, p.requestedById, { kind: "payouts.paid", title: `${formatKobo(p.amountKobo, p.currency)} paid to ${p.contractor.name}`, body: p.ref, link: "/app/payouts" });
  });
}

/** The person who asked (or an approver) cancels a payment not yet sent. */
export async function cancelPayout(ctx: Ctx, id: string) {
  assertCan(ctx, "payout.request");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await locked(tx, ctx.companyId, id);
    const mayApprove = ctx.role === "COMPANY_SUPER_ADMIN" || ctx.role === "MANAGER";
    if (p.requestedById !== ctx.userId && !mayApprove) throw new Error("Only the person who asked, or a manager, can cancel this payment");
    if (p.status !== "REQUESTED" && !(p.status === "APPROVED" && p.method !== "PAYSTACK")) throw new Error("This payment can no longer be cancelled");
    await tx.contractorPayout.update({ where: { id }, data: { status: "CANCELLED", checkoutUrl: "" } });
    await event(tx, p, "cancelled", p.status as Status, "CANCELLED", ctx.userId);
  });
}

// ---------- Reading ----------

export async function payouts(ctx: Ctx) {
  assertCan(ctx, "payout.request");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [rows, contractors, workOrders] = await Promise.all([
      tx.contractorPayout.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 300, include: { contractor: { select: { name: true } }, events: { orderBy: { createdAt: "asc" }, take: 20 } } }),
      tx.contractor.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true, email: true, bankName: true, accountNumber: true, accountName: true, paystackRecipient: true, stripeAccountId: true, stripeReady: true } }),
      tx.workOrder.findMany({ where: { companyId: ctx.companyId, status: { notIn: ["CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, ref: true, title: true, contractorId: true, actualCostKobo: true, approvedCostKobo: true } }),
    ]);
    const people = await tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const name = (id: string | null) => (id ? people.find((u) => u.id === id)?.name ?? "Someone" : "");
    return { rows: rows.map((r) => ({ ...r, requestedByName: name(r.requestedById), decidedByName: name(r.decidedById) })), contractors, workOrders };
  });
}

// ---------- Webhook and checks ----------

/** Paystack's message about a transfer, sent to the company's private payout address and signed with its secret key. */
export async function payoutWebhook(token: string, rawBody: string, signature: string | null) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return { status: 404 };
  const c = await withPlatformAdmin(SYSTEM, (tx) => tx.company.findUnique({ where: { payoutWebhookToken: token }, select: { id: true, payoutPaystackKey: true } }));
  const key = open(c?.payoutPaystackKey);
  if (!c || !key) return { status: 404 };
  const want = Buffer.from(hmacSha512(key, rawBody)), got = Buffer.from(signature ?? "");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { status: 401 };
  const ev = parseTransferEvent(rawBody);
  if (!ev || !ev.reference.startsWith("housy-po-")) return { status: 200, outcome: "ignored" };
  // Trust, but check: ask Paystack directly before recording money as paid.
  const v = await transferApi(key).verify(ev.reference);
  const status = v.ok && v.status !== "unknown" ? v.status : ev.status;
  const outcome = await applyTransfer(c.id, ev.reference, status, v.ok ? v.amountMinor : ev.amountMinor, v.ok ? v.reason : ev.reason, SYSTEM);
  return { status: 200, outcome };
}

/** Scheduled: check transfers still sending (Paystack may answer later), and re-send any whose first answer was lost. */
export async function syncPayouts(limit = 50) {
  const sending = await withPlatformAdmin(SYSTEM, (tx) => tx.$queryRaw<{ id: string; company_id: string }[]>`
    SELECT id, company_id FROM contractor_payouts WHERE status = 'SENDING' AND method = 'PAYSTACK' AND updated_at < now() - interval '2 minutes' ORDER BY updated_at LIMIT ${limit}`);
  const out: Record<string, number> = {};
  for (const r of sending) {
    const s = await sendPaystack(r.company_id, r.id, SYSTEM).catch(() => "SENDING" as Status);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}
