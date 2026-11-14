import { cache } from "react";

/**
 * The currency of the workspace this request is working in, so amounts on a company's pages show in its own currency (₦, $, £…).
 * It is set when the signed-in member is read (getMember) and lives only for that request: outside a request it is always a fresh
 * naira default, so one request can never see another's currency. Amounts that belong to something with its own currency (a
 * listing, an invoice, a client payment) are always formatted with that currency explicitly.
 */
const store = cache((): { currency: string } => ({ currency: "NGN" }));

export function setRequestCurrency(currency: string) {
  try { store().currency = currency; } catch { /* outside a request: nothing to set */ }
}
export function requestCurrency(): string {
  try { return store().currency; } catch { return "NGN"; }
}
