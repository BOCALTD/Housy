import { cache } from "react";

/**
 * The currency of the workspace this request is working in, so amounts on a company's pages show in its own currency (₦, $, £…).
 * It is set when the signed-in member is read (getMember) and lives only for that request: outside a request it is always a fresh
 * naira default, so one request can never see another's currency. Amounts that belong to something with its own currency (a
 * listing, an invoice, a client payment) are always formatted with that currency explicitly.
 */
const store = cache((): { currency: string; timeZone: string; zoneFromPerson: boolean } => ({ currency: "NGN", timeZone: "Africa/Lagos", zoneFromPerson: false }));

export function setRequestCurrency(currency: string) {
  try { store().currency = currency; } catch { /* outside a request: nothing to set */ }
}
export function requestCurrency(): string {
  try { return store().currency; } catch { return "NGN"; }
}

/**
 * The time zone this request shows dates and times in: the signed-in person's own choice, otherwise their workspace's, otherwise
 * their country's usual zone; Lagos outside a request (scheduled jobs) or for visitors.
 */
export function setRequestTimeZone(timeZone: string, fromPerson = false) {
  try {
    const s = store();
    if (s.zoneFromPerson && !fromPerson) return;
    s.timeZone = timeZone;
    if (fromPerson) s.zoneFromPerson = true;
  } catch { /* outside a request */ }
}
export function requestTimeZone(): string {
  try { return store().timeZone; } catch { return "Africa/Lagos"; }
}
