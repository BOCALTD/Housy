import { payoutWebhook } from "@/lib/services/payouts";

export const dynamic = "force-dynamic";

/**
 * Paystack's messages about a company's transfers to contractors. Each company has its own private address (Settings, Payouts);
 * the message must carry Paystack's signature made with that company's secret key, and each outcome is checked with Paystack
 * before it is recorded.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const raw = await req.text();
  if (raw.length > 100_000) return new Response(null, { status: 413 });
  const r = await payoutWebhook((await params).token, raw, req.headers.get("x-paystack-signature")).catch(() => ({ status: 500 }));
  return Response.json({ received: r.status === 200 }, { status: r.status });
}
