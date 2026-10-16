import { cronAuthorised } from "@/lib/cron-auth";
import { generateRenewalInvoices, verifyPending } from "@/lib/services/billing";

export const dynamic = "force-dynamic";

/** Called on a schedule. Asks for renewals, and asks the provider about payments that were never confirmed. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return new Response("Unauthorised", { status: 401 });
  const renewals = await generateRenewalInvoices();
  const pending = await verifyPending();
  return Response.json({ renewals, pending });
}
