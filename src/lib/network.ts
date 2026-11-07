import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

/**
 * Outgoing connections that work on slow and far-away links, as from Nigeria to servers in Europe.
 *
 * Node tries a server's IPv6 and IPv4 addresses in turn but gives each try only a quarter of a second by default. On a
 * link where a connection takes longer than that (and where IPv6 often does not work at all, as on Ubuntu under
 * Windows), every try is abandoned and the request fails with ETIMEDOUT within a second, although the server is fine and
 * curl reaches it. So: IPv4 first, and two and a half seconds per try. Used by the server at start-up (instrumentation)
 * and by command-line tools that make requests.
 */
export function tuneNetwork() {
  try { setDefaultResultOrder("ipv4first"); } catch { /* older Node: keeps its own order */ }
  try { setDefaultAutoSelectFamilyAttemptTimeout(2500); } catch { /* older Node: no per-try limit to raise */ }
}
