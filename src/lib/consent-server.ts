import { cookies } from "next/headers";
import { CONSENT_COOKIE } from "./consent";

/** Whether this visitor has accepted optional cookies. */
export async function optionalCookiesAllowed(): Promise<boolean> {
  return (await cookies()).get(CONSENT_COOKIE)?.value === "all";
}
