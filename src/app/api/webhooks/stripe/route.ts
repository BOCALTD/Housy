import { receiveProviderEvent } from "@/lib/services/billing";

export const dynamic = "force-dynamic";

/**
 * Stripe reports what happened to a payment (plans paid outside Paystack's countries, and clients paying companies there). The body
 * is read exactly as sent, because Stripe's signature covers those bytes; only signed messages are accepted, and a repeated
 * message changes nothing.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 400_000) return new Response("Too large", { status: 413 });
  const r = await receiveProviderEvent(raw, req.headers.get("stripe-signature"), undefined, "STRIPE");
  return Response.json(r.body, { status: r.status });
}
