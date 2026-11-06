"use server";

import { requireMember } from "@/lib/auth";
import { act, withNotice } from "@/lib/forms";
import { confirmListings } from "@/lib/services/listings";

export async function confirmListingsAction(form: FormData) {
  return act("/app/listings", async () => {
    const member = await requireMember("listing.manage");
    const ids = form.getAll("id").map(String).filter(Boolean);
    if (!ids.length) throw new Error("Tick the listings that are still available");
    const n = await confirmListings(member, ids);
    return withNotice("/app/listings", `${n} ${n === 1 ? "listing" : "listings"} confirmed. They show in search for another 45 days.`);
  });
}
