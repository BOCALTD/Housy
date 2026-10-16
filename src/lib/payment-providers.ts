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
  name: "PAYSTACK";
  initialize(i: { reference: string; amountKobo: bigint; email: string; callbackUrl: string; metadata?: Record<string, string> }): Promise<{ ok: true; checkoutUrl: string } | { ok: false; error: string }>;
  /** True only when the signature proves the message came from the provider and was not altered. */
  verifySignature(rawBody: string, signature: string | null): boolean;
  parseEvent(rawBody: string): ParsedEvent | null;
  /** Ask the provider what happened to a payment, instead of trusting a browser that came back from checkout. */
  verify(reference: string): Promise<VerifyOutcome>;
  refund(i: { reference: string; amountKobo: bigint; reason: string }): Promise<{ ok: true; providerRef: string; completed: boolean } | { ok: false; error: string; permanent: boolean }>;
}

const toKobo = (v: unknown): bigint | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? BigInt(v) : typeof v === "string" && /^\d{1,15}$/.test(v) ? BigInt(v) : null);
const asStr = (v: unknown, max = 200) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");

export function paystackProvider(secretKey: string, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const base = "https://api.paystack.co";
  async function call(path: string, init?: { method?: string; body?: unknown }) {
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
  }
  return {
    name: "PAYSTACK",
    async initialize(i) {
      const r = await call("/transaction/initialize", { method: "POST", body: { email: i.email, amount: Number(i.amountKobo), currency: "NGN", reference: i.reference, callback_url: i.callbackUrl, metadata: i.metadata ?? {} } });
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
      const r = await call("/refund", { method: "POST", body: { transaction: i.reference, amount: Number(i.amountKobo), currency: "NGN", customer_note: i.reason.slice(0, 200), merchant_note: i.reason.slice(0, 200) } });
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
