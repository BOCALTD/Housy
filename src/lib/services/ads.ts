import type { Prisma } from "@prisma/client";
import type { Tx } from "../db";

// Placeholder until advertising is added in the next step of this phase.
export async function fundCampaign(_tx: Tx, _inv: Prisma.InvoiceGetPayload<object>, _now: Date): Promise<void> {
  throw new Error("Advertising is not available yet");
}
export async function unspentFor(_tx: Tx, _campaignId: string): Promise<bigint> { return 0n; }
export async function applyCampaignRefund(_tx: Tx, _campaignId: string, _amount: bigint, _now: Date): Promise<void> {}
