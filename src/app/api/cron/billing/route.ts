import { cronAuthorised } from "@/lib/cron-auth";
import { generateRenewalInvoices, verifyPending } from "@/lib/services/billing";
import { evaluateCampaigns } from "@/lib/services/ads";
import { purgeFlatmateCheckImages } from "@/lib/services/flatmates";
import { remindUnconfirmedListings } from "@/lib/services/listings";
import { expireOffers } from "@/lib/services/verification-cases";
import { matureEarnings } from "@/lib/services/verification-finance";
import { credentialSweep } from "@/lib/services/verification-quality";

export const dynamic = "force-dynamic";

/** Called on a schedule. Asks for renewals, asks the provider about payments that were never confirmed, and stops or restarts adverts whose conditions changed. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return new Response("Unauthorised", { status: 401 });
  const renewals = await generateRenewalInvoices();
  const pending = await verifyPending();
  const ads = await evaluateCampaigns();
  // Data kept only as long as needed: flatmate ID pictures go 30 days after the decision.
  const idImagesDeleted = await purgeFlatmateCheckImages("system").catch(() => 0);
  // Listings not confirmed as still available stop showing after 45 days; companies get one reminder a week before.
  const listingReminders = await remindUnconfirmedListings().catch(() => null);
  // Verification network: unanswered offers go back to Housy; earnings past their waiting time become payable.
  await expireOffers().catch(() => null);
  const earningsMatured = await matureEarnings().catch(() => null);
  // Licences and certificates: a reminder before expiry, a notice when one lapses (the provider is then not offered cases).
  const credentials = await credentialSweep().catch(() => null);
  return Response.json({ renewals, pending, ads, idImagesDeleted, listingReminders, earningsMatured, credentials });
}
