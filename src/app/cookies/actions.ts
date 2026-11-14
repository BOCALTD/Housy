"use server";

import { cookies } from "next/headers";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, isConsentChoice } from "@/lib/consent";
import { secureCookies } from "@/lib/cookie-security";

const CODE = /^[A-Za-z0-9_-]{4,40}$/;

/**
 * Save the visitor's cookie choice. With "Accept all", a referral code carried in the address (from a shared link opened
 * before the choice was made) is remembered now, so the person who invited them can still be thanked.
 */
export async function saveCookieChoice(choice: string, via: string | null) {
  if (!isConsentChoice(choice)) return;
  const jar = await cookies();
  const secure = await secureCookies();
  jar.set(CONSENT_COOKIE, choice, { path: "/", maxAge: CONSENT_MAX_AGE, sameSite: "lax", secure });
  if (choice === "all" && via && CODE.test(via)) jar.set("ref", `${via}.${Date.now()}`, { path: "/", maxAge: 30 * 864e2, httpOnly: true, sameSite: "lax", secure });
  if (choice === "essential") { jar.delete("ref"); jar.delete("pv_vid"); }
}
