import { receiveProviderEvent } from "@/lib/services/billing";

export const dynamic = "force-dynamic";

/**
 * The payment provider reports what happened to a payment. The body is read exactly as sent, because the signature covers those exact
 * bytes. A message is accepted only if the signature checks out; a repeated message is acknowledged and changes nothing.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 200_000) return new Response("Too large", { status: 413 });
  const r = await receiveProviderEvent(raw, req.headers.get("x-paystack-signature"));
  return Response.json(r.body, { status: r.status });
}
