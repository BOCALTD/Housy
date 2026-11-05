import { cronAuthorised } from "@/lib/cron-auth";
import { generateRenewalInvoices, verifyPending } from "@/lib/services/billing";
import { evaluateCampaigns } from "@/lib/services/ads";
import { purgeFlatmateCheckImages } from "@/lib/services/flatmates";

export const dynamic = "force-dynamic";

/** Called on a schedule. Asks for renewals, asks the provider about payments that were never confirmed, and stops or restarts adverts whose conditions changed. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return new Response("Unauthorised", { status: 401 });
  const renewals = await generateRenewalInvoices();
  const pending = await verifyPending();
  const ads = await evaluateCampaigns();
  // Data kept only as long as needed: flatmate ID pictures go 30 days after the decision.
  const idImagesDeleted = await purgeFlatmateCheckImages("system").catch(() => 0);
  return Response.json({ renewals, pending, ads, idImagesDeleted });
}
