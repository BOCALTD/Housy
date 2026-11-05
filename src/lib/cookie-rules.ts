/**
 * Whether cookies must carry the Secure flag, from how the request arrived. Browsers drop a Secure cookie sent over plain
 * http, so marking it Secure on a server reached by http (an IP address before the certificate is set up) would make
 * sign-in fail silently. The proxy's X-Forwarded-Proto decides; without one, the public address; without that, production.
 */
export function secureFor(forwardedProto: string | null, appUrl: string | undefined, nodeEnv: string | undefined): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  if (appUrl) return appUrl.startsWith("https://");
  return nodeEnv === "production";
}
