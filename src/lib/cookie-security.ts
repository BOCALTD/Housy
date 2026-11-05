import { headers } from "next/headers";
import { secureFor } from "./cookie-rules";

/** Whether cookies set in this request must be Secure (see cookie-rules.ts). */
export async function secureCookies(): Promise<boolean> {
  let proto: string | null = null;
  try { proto = (await headers()).get("x-forwarded-proto"); } catch { /* outside a request */ }
  return secureFor(proto, process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV);
}
