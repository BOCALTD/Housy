"use server";

import { act, str } from "@/lib/forms";
import { siteOrigin } from "@/lib/origin";
import { rateLimit } from "@/lib/ratelimit";
import { visitorIp } from "@/lib/request-ip";
import { startOnlinePayment } from "@/lib/services/client-payments";

/** The payer chose to pay online: open Paystack's checkout. */
export async function payOnlineAction(form: FormData) {
  const token = str(form, "token");
  const back = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? `/pay/${token}` : "/";
  return act(back, async () => {
    if (!(await rateLimit(`pay:${await visitorIp()}`, 10, 60_000))) throw new Error("Too many tries. Wait a minute and try again.");
    return startOnlinePayment(token, { name: str(form, "name"), email: str(form, "email") }, await siteOrigin());
  });
}
