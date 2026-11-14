import { createHmac } from "node:crypto";
import { hmacSha512, sameHex, sha256 } from "./billing-rules";

// Payment providers sit behind one interface, so the rest of the platform never knows which one is connected. A provider checks
// that a message really came from it, says what happened to a payment, and can give money back. Nothing here touches the database.

export type VerifyOutcome =
  | { ok: true; status: "success" | "failed" | "pending"; amountKobo: bigint; currency: string; providerTxId: string }
  | { ok: false; error: string };

export type ParsedEvent = {
  /** Unique per provider message. The same message sent twice has the same id. */
  eventId: string;
  kind: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "REFUND_COMPLETED" | "REFUND_FAILED" | "IGNORED";
  rawKind: string;
  reference: string;
  amountKobo: bigint | null;
  currency: string;
  providerTxId: string;
};

export interface PaymentProvider {
  name: "PAYSTACK" | "STRIPE";
  /** Amounts are minor units of `currency` (naira when not given). */
  initialize(i: { reference: string; amountKobo: bigint; email: string; callbackUrl: string; metadata?: Record<string, string>; currency?: string; description?: string }): Promise<{ ok: true; checkoutUrl: string } | { ok: false; error: string }>;
  /** True only when the signature proves the message came from the provider and was not altered. */
  verifySignature(rawBody: string, signature: string | null): boolean;
  parseEvent(rawBody: string): ParsedEvent | null;
  /** Ask the provider what happened to a payment, instead of trusting a browser that came back from checkout. */
  verify(reference: string): Promise<VerifyOutcome>;
  refund(i: { reference: string; amountKobo: bigint; reason: string }): Promise<{ ok: true; providerRef: string; completed: boolean } | { ok: false; error: string; permanent: boolean }>;
}

const toKobo = (v: unknown): bigint | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? BigInt(v) : typeof v === "string" && /^\d{1,15}$/.test(v) ? BigInt(v) : null);
const asStr = (v: unknown, max = 200) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");

function paystackCaller(secretKey: string, fetchImpl: typeof fetch) {
  const base = "https://api.paystack.co";
  return async function call(path: string, init?: { method?: string; body?: unknown }) {
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: init?.method ?? "GET",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
      const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: Record<string, unknown> };
      return { http: res.status, ok: res.ok && json.status === true, message: json.message ?? "", data: json.data ?? {} };
    } catch (e) {
      return { http: 0, ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "network error", data: {} as Record<string, unknown> };
    }
  };
}

export function paystackProvider(secretKey: string, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const call = paystackCaller(secretKey, fetchImpl);
  return {
    name: "PAYSTACK",
    async initialize(i) {
      const r = await call("/transaction/initialize", { method: "POST", body: { email: i.email, amount: Number(i.amountKobo), currency: i.currency ?? "NGN", reference: i.reference, callback_url: i.callbackUrl, metadata: i.metadata ?? {} } });
      const url = asStr(r.data.authorization_url, 1000);
      if (r.ok && url.startsWith("https://")) return { ok: true, checkoutUrl: url };
      return { ok: false, error: `The payment provider did not start the payment${r.message ? `: ${r.message}` : ""}`.slice(0, 300) };
    },
    verifySignature(rawBody, signature) {
      if (!signature) return false;
      return sameHex(hmacSha512(secretKey, rawBody), signature);
    },
    parseEvent(rawBody) {
      let j: { event?: unknown; data?: Record<string, unknown> };
      try { j = JSON.parse(rawBody); } catch { return null; }
      const event = asStr(j.event, 100), d = j.data ?? {};
      if (!event || typeof d !== "object") return null;
      const kinds: Record<string, ParsedEvent["kind"]> = { "charge.success": "PAYMENT_SUCCEEDED", "charge.failed": "PAYMENT_FAILED", "refund.processed": "REFUND_COMPLETED", "refund.failed": "REFUND_FAILED" };
      const kind = kinds[event] ?? "IGNORED";
      const reference = asStr(d.transaction_reference ?? d.reference);
      const id = asStr(d.id) || asStr(d.refund_reference) || sha256(rawBody).slice(0, 32);
      return { eventId: `${event}:${id}`, kind, rawKind: event, reference, amountKobo: toKobo(d.amount), currency: asStr(d.currency, 8) || "NGN", providerTxId: asStr(d.id) };
    },
    async verify(reference) {
      const r = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
      if (!r.ok) return { ok: false, error: `${r.http || "no answer"} ${r.message}`.trim().slice(0, 300) };
      const s = asStr(r.data.status, 30);
      const amount = toKobo(r.data.amount);
      if (amount === null) return { ok: false, error: "The provider's answer had no amount" };
      const status = s === "success" ? "success" : s === "failed" || s === "abandoned" || s === "reversed" ? "failed" : "pending";
      return { ok: true, status, amountKobo: amount, currency: asStr(r.data.currency, 8) || "NGN", providerTxId: asStr(r.data.id) };
    },
    async refund(i) {
      const r = await call("/refund", { method: "POST", body: { transaction: i.reference, amount: Number(i.amountKobo), customer_note: i.reason.slice(0, 200), merchant_note: i.reason.slice(0, 200) } });
      if (r.ok) return { ok: true, providerRef: asStr(r.data.id) || asStr(r.data.reference), completed: asStr(r.data.status, 30) === "processed" };
      return { ok: false, permanent: r.http >= 400 && r.http < 500 && r.http !== 429 && r.http !== 408, error: `${r.http || "no answer"} ${r.message}`.trim().slice(0, 300) };
    },
  };
}

/** The connected provider, or null when none is. Nothing is ever pretended to be paid. */
export function configuredProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider | null {
  if (env.PAYSTACK_SECRET_KEY) return paystackProvider(env.PAYSTACK_SECRET_KEY);
  return null;
}


// ---------- Split payments for companies and agents (Paystack subaccounts) ----------

export type Bank = { name: string; code: string };
export type SplitApi = {
  /** Banks in a Paystack country ("nigeria", "ghana", "kenya", "south africa"). */
  banks(country?: string, currency?: string): Promise<Bank[]>;
  /** The account holder's name as the bank has it, to show before saving. */
  resolveAccount(accountNumber: string, bankCode: string): Promise<{ ok: true; accountName: string } | { ok: false; error: string }>;
  /** A settlement account for a company: payments split to it go to its bank, less Housy's share. */
  createSubaccount(i: { businessName: string; bankCode: string; accountNumber: string; contactEmail: string }): Promise<{ ok: true; code: string } | { ok: false; error: string }>;
  updateSubaccount(code: string, i: { businessName: string; bankCode: string; accountNumber: string }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Start a payment that Paystack splits: Housy keeps `housyShareKobo`, the subaccount gets the rest, less Paystack's fee (which the subaccount bears). */
  initializeSplit(i: { reference: string; amountKobo: bigint; email: string; callbackUrl: string; subaccount: string; housyShareKobo: bigint; metadata?: Record<string, string>; currency?: string }): Promise<{ ok: true; checkoutUrl: string } | { ok: false; error: string }>;
};

export function paystackSplitApi(secretKey: string, fetchImpl: typeof fetch = fetch): SplitApi {
  const call = paystackCaller(secretKey, fetchImpl);
  const fail = (r: { http: number; message: string }) => `${r.message || "The payment provider did not answer"}`.slice(0, 300);
  return {
    async banks(country = "nigeria", currency = "NGN") {
      const r = await call(`/bank?country=${encodeURIComponent(country)}&currency=${encodeURIComponent(currency)}&perPage=200`);
      const list = (r as unknown as { data: unknown }).data;
      const rows = Array.isArray(list) ? list : [];
      return rows.map((b: Record<string, unknown>) => ({ name: asStr(b.name, 120), code: asStr(b.code, 20) })).filter((b) => b.name && b.code).sort((a, b) => a.name.localeCompare(b.name));
    },
    async resolveAccount(accountNumber, bankCode) {
      const r = await call(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
      const name = asStr(r.data.account_name, 200);
      return r.ok && name ? { ok: true, accountName: name } : { ok: false, error: "The bank did not confirm that account number. Check the number and the bank." };
    },
    async createSubaccount(i) {
      const r = await call("/subaccount", { method: "POST", body: { business_name: i.businessName.slice(0, 100), settlement_bank: i.bankCode, account_number: i.accountNumber, percentage_charge: 0, primary_contact_email: i.contactEmail || undefined } });
      const code = asStr(r.data.subaccount_code, 60);
      return r.ok && code ? { ok: true, code } : { ok: false, error: fail(r) };
    },
    async updateSubaccount(code, i) {
      const r = await call(`/subaccount/${encodeURIComponent(code)}`, { method: "PUT", body: { business_name: i.businessName.slice(0, 100), settlement_bank: i.bankCode, account_number: i.accountNumber } });
      return r.ok ? { ok: true } : { ok: false, error: fail(r) };
    },
    async initializeSplit(i) {
      const r = await call("/transaction/initialize", { method: "POST", body: { email: i.email, amount: Number(i.amountKobo), currency: i.currency ?? "NGN", reference: i.reference, callback_url: i.callbackUrl, subaccount: i.subaccount, transaction_charge: Number(i.housyShareKobo), bearer: "subaccount", metadata: i.metadata ?? {} } });
      const url = asStr(r.data.authorization_url, 1000);
      if (r.ok && url.startsWith("https://")) return { ok: true, checkoutUrl: url };
      return { ok: false, error: `The payment provider did not start the payment${r.message ? `: ${r.message}` : ""}`.slice(0, 300) };
    },
  };
}


// ---------- Stripe (for countries Paystack does not serve) ----------

/** Stripe's API takes form fields with nested names: a[b][c]=v. */
export function stripeForm(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) out.push(...stripeForm(v as Record<string, unknown>, key));
    else if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? out.push(...stripeForm(item as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

function stripeCaller(secretKey: string, fetchImpl: typeof fetch) {
  return async function call(path: string, init?: { method?: string; form?: Record<string, unknown>; idempotencyKey?: string }) {
    try {
      const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
        method: init?.method ?? "GET",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20", ...(init?.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}) },
        body: init?.form ? stripeForm(init.form).join("&") : undefined,
        signal: AbortSignal.timeout(20000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
      return { http: res.status, ok: res.ok, message: json.error?.message ?? "", data: json };
    } catch (e) {
      return { http: 0, ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "network error", data: {} as Record<string, unknown> };
    }
  };
}

/** Stripe signs each message: "t=<time>,v1=<HMAC-SHA256 of time.body>". Messages older than five minutes are refused. */
export function stripeSignatureValid(webhookSecret: string, rawBody: string, header: string | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!webhookSecret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300 || !sigs.length) return false;
  const expected = createHmac("sha256", webhookSecret).update(`${t}.${rawBody}`).digest("hex");
  return sigs.some((s) => sameHex(expected, s));
}

const lower = (c?: string) => (c ?? "NGN").toLowerCase();

/** Find the payment Stripe holds for one of our references (we put the reference in its metadata). */
async function intentFor(call: ReturnType<typeof stripeCaller>, reference: string) {
  const q = encodeURIComponent(`metadata['reference']:'${reference.replace(/'/g, "")}'`);
  const r = await call(`/payment_intents/search?query=${q}&limit=5`);
  const rows = Array.isArray(r.data.data) ? (r.data.data as Record<string, unknown>[]) : [];
  return { r, intent: rows.find((p) => p.status === "succeeded") ?? rows[0] ?? null };
}

export function stripeProvider(secretKey: string, webhookSecret: string, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const call = stripeCaller(secretKey, fetchImpl);
  return {
    name: "STRIPE",
    async initialize(i) {
      const r = await call("/checkout/sessions", { method: "POST", idempotencyKey: `init-${i.reference}`, form: {
        mode: "payment", customer_email: i.email, client_reference_id: i.reference, success_url: i.callbackUrl, cancel_url: i.callbackUrl,
        line_items: [{ quantity: 1, price_data: { currency: lower(i.currency), unit_amount: Number(i.amountKobo), product_data: { name: (i.description || "Housy invoice").slice(0, 200) } } }],
        metadata: { reference: i.reference, ...(i.metadata ?? {}) }, payment_intent_data: { metadata: { reference: i.reference, ...(i.metadata ?? {}) } },
      } });
      const url = asStr(r.data.url, 1000);
      if (r.ok && url.startsWith("https://")) return { ok: true, checkoutUrl: url };
      return { ok: false, error: `The payment provider did not start the payment${r.message ? `: ${r.message}` : ""}`.slice(0, 300) };
    },
    verifySignature(rawBody, signature) { return stripeSignatureValid(webhookSecret, rawBody, signature); },
    parseEvent(rawBody) {
      let j: { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
      try { j = JSON.parse(rawBody); } catch { return null; }
      const type = asStr(j.type, 100), o = j.data?.object ?? {};
      if (!type || typeof o !== "object") return null;
      const meta = (o.metadata ?? {}) as Record<string, unknown>;
      if (type === "payment_intent.succeeded" || type === "payment_intent.payment_failed") {
        return { eventId: `${type}:${asStr(o.id)}`, kind: type === "payment_intent.succeeded" ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED", rawKind: type, reference: asStr(meta.reference), amountKobo: toKobo(type === "payment_intent.succeeded" ? o.amount_received : o.amount), currency: asStr(o.currency, 8).toUpperCase(), providerTxId: asStr(o.id) };
      }
      if (type === "refund.updated" || type === "refund.created" || type === "refund.failed") {
        const st = asStr(o.status, 30);
        const kind = st === "succeeded" ? "REFUND_COMPLETED" : st === "failed" || st === "canceled" ? "REFUND_FAILED" : "IGNORED";
        return { eventId: `${type}:${asStr(o.id)}:${st}`, kind, rawKind: type, reference: asStr(meta.reference), amountKobo: toKobo(o.amount), currency: asStr(o.currency, 8).toUpperCase(), providerTxId: asStr(o.id) };
      }
      return { eventId: `${type}:${asStr(j.id) || sha256(rawBody).slice(0, 32)}`, kind: "IGNORED", rawKind: type, reference: asStr(meta.reference), amountKobo: null, currency: "", providerTxId: "" };
    },
    async verify(reference) {
      const { r, intent } = await intentFor(call, reference);
      if (!r.ok) return { ok: false, error: `${r.http || "no answer"} ${r.message}`.trim().slice(0, 300) };
      if (!intent) return { ok: true, status: "pending", amountKobo: 0n, currency: "", providerTxId: "" };
      const st = asStr(intent.status, 30);
      const amount = toKobo(st === "succeeded" ? intent.amount_received : intent.amount) ?? 0n;
      return { ok: true, status: st === "succeeded" ? "success" : st === "canceled" ? "failed" : "pending", amountKobo: amount, currency: asStr(intent.currency, 8).toUpperCase(), providerTxId: asStr(intent.id) };
    },
    async refund(i) {
      const { intent } = await intentFor(call, i.reference);
      if (!intent) return { ok: false, permanent: true, error: "The provider has no payment with this reference" };
      const r = await call("/refunds", { method: "POST", idempotencyKey: `refund-${i.reference}-${i.amountKobo}`, form: { payment_intent: asStr(intent.id), amount: Number(i.amountKobo), metadata: { reference: i.reference, reason: i.reason.slice(0, 200) } } });
      if (r.ok) return { ok: true, providerRef: asStr(r.data.id), completed: asStr(r.data.status, 30) === "succeeded" };
      return { ok: false, permanent: r.http >= 400 && r.http < 500 && r.http !== 429 && r.http !== 408, error: `${r.http || "no answer"} ${r.message}`.trim().slice(0, 300) };
    },
  };
}

export type StripeConnectApi = {
  /** A Stripe account for a company, which Stripe checks and pays out to the company's bank. */
  createAccount(i: { country: string; email: string; businessName: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** The page where the company gives Stripe its details and bank account (a fresh link each time; links expire). */
  onboardingLink(account: string, returnUrl: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  /** Whether Stripe has finished checking the account and it can take payments. */
  accountReady(account: string): Promise<boolean>;
  /** A checkout where the company receives the payment, less Housy's fee. */
  initializeDestination(i: { reference: string; amountMinor: bigint; currency: string; email: string; callbackUrl: string; account: string; housyShareMinor: bigint; description: string }): Promise<{ ok: true; checkoutUrl: string } | { ok: false; error: string }>;
};

export function stripeConnectApi(secretKey: string, fetchImpl: typeof fetch = fetch): StripeConnectApi {
  const call = stripeCaller(secretKey, fetchImpl);
  return {
    async createAccount(i) {
      const r = await call("/accounts", { method: "POST", form: { type: "express", country: i.country, email: i.email || undefined, business_profile: { name: i.businessName.slice(0, 100) }, capabilities: { card_payments: { requested: "true" }, transfers: { requested: "true" } } } });
      const id = asStr(r.data.id, 60);
      return r.ok && id.startsWith("acct_") ? { ok: true, id } : { ok: false, error: r.message || "Stripe did not create the account" };
    },
    async onboardingLink(account, returnUrl) {
      const r = await call("/account_links", { method: "POST", form: { account, refresh_url: returnUrl, return_url: returnUrl, type: "account_onboarding" } });
      const url = asStr(r.data.url, 1000);
      return r.ok && url.startsWith("https://") ? { ok: true, url } : { ok: false, error: r.message || "Stripe did not open the set-up page" };
    },
    async accountReady(account) {
      const r = await call(`/accounts/${encodeURIComponent(account)}`);
      return r.ok && r.data.charges_enabled === true && r.data.payouts_enabled === true;
    },
    async initializeDestination(i) {
      const r = await call("/checkout/sessions", { method: "POST", idempotencyKey: `init-${i.reference}`, form: {
        mode: "payment", customer_email: i.email, client_reference_id: i.reference, success_url: i.callbackUrl, cancel_url: i.callbackUrl,
        line_items: [{ quantity: 1, price_data: { currency: lower(i.currency), unit_amount: Number(i.amountMinor), product_data: { name: i.description.slice(0, 200) } } }],
        metadata: { reference: i.reference },
        payment_intent_data: { application_fee_amount: Number(i.housyShareMinor) || undefined, transfer_data: { destination: i.account }, metadata: { reference: i.reference } },
      } });
      const url = asStr(r.data.url, 1000);
      if (r.ok && url.startsWith("https://")) return { ok: true, checkoutUrl: url };
      return { ok: false, error: `The payment page could not be opened${r.message ? `: ${r.message}` : ""}`.slice(0, 300) };
    },
  };
}
