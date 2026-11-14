/**
 * The visitor's address, for rate limits and abuse checks only. Behind Cloudflare (Admin → Settings, or TRUST_CLOUDFLARE=1)
 * it is read from Cloudflare's CF-Connecting-IP header; otherwise from the reverse proxy's X-Forwarded-For. The Cloudflare
 * header is trusted only when that setting is on, because anyone can send it to a server that is not behind Cloudflare.
 */
export function ipFromHeaders(h: Headers, trustCloudflare: boolean): string {
  const cf = trustCloudflare ? h.get("cf-connecting-ip")?.trim() : "";
  return cf || (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

async function trustCloudflare() {
  if (process.env.TRUST_CLOUDFLARE === "1") return true;
  try { return (await (await import("./services/platform-config")).platformConfig()).trustCloudflare; } catch { return false; }
}

/** The visitor's address from a request. */
export async function requestIp(req: Request): Promise<string> {
  return ipFromHeaders(req.headers, await trustCloudflare());
}

/** The visitor's address inside a server action or page. */
export async function visitorIp(): Promise<string> {
  const { headers } = await import("next/headers");
  return ipFromHeaders(await headers(), await trustCloudflare());
}
