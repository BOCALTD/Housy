import { withPlatformAdmin } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo, formatKobo } from "../money";
import { post } from "./billing";
import { reconcile as reconcileRewards } from "./rewards";

/**
 * The platform's own books: what subscriptions and advertising have brought in, what is held for adverts not yet run,
 * and what is parked in suspense awaiting a decision. Commissions live in each company's own books; referral and vacancy
 * rewards in the reward ledger, shown here beside these but never mixed with them.
 */

export const LEDGERS = ["SUBSCRIPTION", "ADVERTISING"] as const;
export const ACCOUNTS = ["REVENUE", "FUNDS_HELD", "SUSPENSE"] as const;
const PAGE = 25;

async function adminOnly(id: string) {
  const u = await withPlatformAdmin(id, (tx) => tx.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } }));
  if (!u?.isPlatformAdmin) throw new Error("Only a platform administrator can do this");
}

/** Balance of each account in each ledger, from the entries. */
export async function balances(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.financeEntry.groupBy({ by: ["ledger", "account"], _sum: { amountKobo: true }, _count: true });
    return LEDGERS.map((ledger) => ({
      ledger,
      accounts: ACCOUNTS.map((account) => {
        const r = rows.find((x) => x.ledger === ledger && x.account === account);
        return { account, kobo: r?._sum.amountKobo ?? 0n, entries: r?._count ?? 0 };
      }),
    }));
  });
}

export async function entries(adminId: string, o: { ledger?: string; page?: number } = {}) {
  await adminOnly(adminId);
  const where = o.ledger && (LEDGERS as readonly string[]).includes(o.ledger) ? { ledger: o.ledger as (typeof LEDGERS)[number] } : {};
  return withPlatformAdmin(adminId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.financeEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (o.page ?? 0) * PAGE, take: PAGE }),
      tx.financeEntry.count({ where }),
    ]);
    return { rows, total, pageSize: PAGE };
  });
}

const csvCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
export async function entriesCsv(adminId: string, ledger?: string) {
  await adminOnly(adminId);
  const where = ledger && (LEDGERS as readonly string[]).includes(ledger) ? { ledger: ledger as (typeof LEDGERS)[number] } : {};
  const rows = await withPlatformAdmin(adminId, (tx) => tx.financeEntry.findMany({ where, orderBy: { createdAt: "asc" }, take: 20000 }));
  const head = ["Date", "Ledger", "Kind", "Account", "Amount (NGN)", "Invoice", "Payment", "Campaign", "Verified event", "Authorised by", "Note"];
  const body = rows.map((e) => [e.createdAt.toISOString(), e.ledger, e.kind, e.account, (Number(e.amountKobo) / 100).toFixed(2), e.invoiceId ?? "", e.paymentId ?? "", e.campaignId ?? "", e.eventId ?? "", e.actorId ?? "", e.note]);
  return [head, ...body].map((r) => r.map((c) => `"${csvCell(String(c))}"`).join(",")).join("\r\n") + "\r\n";
}

/** A correction. It needs a named person and a reason, and it adds an entry; nothing already written is changed. */
export async function adjust(adminId: string, raw: { ledger: string; account: string; amount: string; note: string }) {
  await adminOnly(adminId);
  if (!(LEDGERS as readonly string[]).includes(raw.ledger)) throw new Error("Choose a ledger");
  if (!(ACCOUNTS as readonly string[]).includes(raw.account)) throw new Error("Choose an account");
  const note = raw.note.trim();
  if (note.length < 5) throw new Error("Say why this correction is needed (at least 5 characters)");
  const neg = raw.amount.trim().startsWith("-");
  let kobo: bigint;
  try { kobo = parseNairaToKobo(raw.amount.replace(/^[-+]/, "")); } catch { throw new Error("Enter an amount greater than zero, with a minus sign to take money out"); }
  if (kobo <= 0n) throw new Error("Enter an amount greater than zero, with a minus sign to take money out");
  if (kobo > 100_000_000_00n) throw new Error("That amount is too large for a correction");
  return withPlatformAdmin(adminId, async (tx) => {
    const e = await post(tx, { ledger: raw.ledger as (typeof LEDGERS)[number], kind: "ADJUSTMENT", account: raw.account as (typeof ACCOUNTS)[number], amountKobo: neg ? -kobo : kobo, actorId: adminId, note });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "finance_entry", entityId: e.id, action: "finance.adjusted", detail: { ledger: raw.ledger, account: raw.account, amount: formatKobo(neg ? -kobo : kobo), note } });
    return e;
  });
}

export interface FinanceFinding { code: string; message: string; refs: string[] }

/** Checks that invoices, payments, refunds, adverts and the ledger tell the same story. No findings means they do. */
export async function reconcileFinance(adminId: string, now = new Date()) {
  await adminOnly(adminId);
  const data = await withPlatformAdmin(adminId, async (tx) => ({
    invoices: await tx.invoice.findMany({ take: 10000 }),
    payments: await tx.payment.findMany({ take: 10000 }),
    refunds: await tx.refund.findMany({ take: 10000 }),
    entries: await tx.financeEntry.findMany({ take: 50000 }),
    events: await tx.paymentEvent.findMany({ where: { outcome: "UNMATCHED_REFUND" }, take: 200 }),
    campaigns: await tx.adCampaign.findMany({ where: { invoiceId: { not: null } }, take: 10000 }),
  }));
  const findings: FinanceFinding[] = [];
  const add = (code: string, message: string, refs: string[]) => { if (refs.length) findings.push({ code, message, refs: refs.slice(0, 20) }); };

  const byPay = new Map<string, bigint>();
  const byCampaign = new Map<string, { spendRevenue: bigint; spendHeld: bigint }>();
  const refundEntries = new Map<string, bigint>();
  for (const e of data.entries) {
    if (e.paymentId) byPay.set(e.paymentId, (byPay.get(e.paymentId) ?? 0n) + e.amountKobo);
    if (e.kind === "REFUND" && e.refundId) refundEntries.set(e.refundId, (refundEntries.get(e.refundId) ?? 0n) - e.amountKobo);
    if (e.kind === "SPEND" && e.campaignId) {
      const c = byCampaign.get(e.campaignId) ?? { spendRevenue: 0n, spendHeld: 0n };
      if (e.account === "REVENUE") c.spendRevenue += e.amountKobo; else if (e.account === "FUNDS_HELD") c.spendHeld += e.amountKobo;
      byCampaign.set(e.campaignId, c);
    }
  }
  const settled = (s: string) => s === "SUCCEEDED" || s === "REVIEW";
  add("PAID_WITHOUT_PAYMENT", "Invoices marked paid with no succeeded payment behind them.", data.invoices.filter((i) => i.status === "PAID" && !data.payments.some((p) => p.invoiceId === i.id && p.status === "SUCCEEDED")).map((i) => i.ref));
  add("PAYMENT_NOT_IN_BOOKS", "Payments whose money is not in the ledger.", data.payments.filter((p) => settled(p.status) && !data.entries.some((e) => e.paymentId === p.id && e.kind === "PAYMENT")).map((p) => p.ref));
  add("PAYMENT_TOTAL_MISMATCH", "Payments where the ledger does not equal money received less money refunded.", data.payments.filter((p) => settled(p.status) && (byPay.get(p.id) ?? 0n) !== (p.receivedKobo ?? 0n) - p.refundedKobo).map((p) => p.ref));
  add("UNSETTLED_IN_BOOKS", "Payments that are not settled but have ledger entries.", data.payments.filter((p) => !settled(p.status) && (byPay.get(p.id) ?? 0n) !== 0n).map((p) => p.ref));
  add("REFUND_MISMATCH", "Completed refunds whose ledger entries differ from the amount refunded.", data.refunds.filter((r) => r.status === "COMPLETED" && (refundEntries.get(r.id) ?? 0n) !== r.amountKobo).map((r) => r.ref));
  add("REFUND_BOOKED_NOT_DONE", "Refunds that are not complete but are already in the ledger.", data.refunds.filter((r) => r.status !== "COMPLETED" && (refundEntries.get(r.id) ?? 0n) !== 0n).map((r) => r.ref));
  add("UNMATCHED_REFUND", "Refund messages from the provider that match no refund of ours. Look them up with the provider.", data.events.map((e) => e.reference || e.eventId));
  add("PAYMENT_NEEDS_DECISION", "Payments held for review, with their money in suspense.", data.payments.filter((p) => p.status === "REVIEW").map((p) => p.ref));
  const day = 864e5;
  add("STALE_PENDING_PAYMENT", "Payments waiting more than 2 days for the provider to confirm.", data.payments.filter((p) => p.status === "PENDING" && p.provider !== "MANUAL" && now.getTime() - p.createdAt.getTime() > 2 * day).map((p) => p.ref));
  add("STALE_PENDING_REFUND", "Refunds waiting more than 7 days.", data.refunds.filter((r) => r.status === "PENDING" && now.getTime() - r.createdAt.getTime() > 7 * day).map((r) => r.ref));
  add("CAMPAIGN_NOT_BOOKED", "Adverts whose spending has not been fully entered in the books.", data.campaigns.filter((c) => c.postedKobo > c.spentKobo || (c.status === "ENDED" && c.postedKobo !== c.spentKobo)).map((c) => c.ref));
  add("CAMPAIGN_LEDGER_MISMATCH", "Adverts whose ledger spending differs from what was booked on the campaign.", data.campaigns.filter((c) => { const b = byCampaign.get(c.id) ?? { spendRevenue: 0n, spendHeld: 0n }; return b.spendRevenue !== c.postedKobo || b.spendHeld !== -c.postedKobo; }).map((c) => c.ref));

  const held = data.entries.filter((e) => e.account === "FUNDS_HELD").reduce((n, e) => n + e.amountKobo, 0n);
  const expectedHeld = data.campaigns.reduce((n, c) => n + c.fundedKobo - c.postedKobo, 0n);
  if (held !== expectedHeld) findings.push({ code: "FUNDS_HELD_MISMATCH", message: `Money held for adverts is ${formatKobo(held)} but campaigns say ${formatKobo(expectedHeld)}.`, refs: [] });
  const rewards = await reconcileRewards(adminId);
  for (const f of rewards.findings) findings.push({ code: `REWARDS_${f.code}`, message: f.message, refs: f.refs });
  return { findings, balanced: findings.length === 0, checkedAt: now };
}
