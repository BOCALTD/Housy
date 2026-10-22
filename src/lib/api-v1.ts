import { API_ERRORS, API_RATE_KEY_PER_MINUTE, API_RATE_PUBLIC_PER_MINUTE, API_VERSION, bearerFrom, hasScope, type ApiErrorName, type ApiScope } from "./api-rules";
import { rateLimit } from "./ratelimit";
import { authenticateApiKey, type ApiCaller } from "./services/api-keys";

const base = { "X-API-Version": API_VERSION, "X-Content-Type-Options": "nosniff" };

export function apiError(name: ApiErrorName, extra: Record<string, string> = {}) {
  const e = API_ERRORS[name];
  return Response.json({ error: { code: e.code, message: e.message }, meta: { version: API_VERSION } }, { status: e.status, headers: { ...base, "Cache-Control": "no-store", ...extra } });
}

export function originOf(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return (configured && /^https?:\/\//.test(configured) ? configured : new URL(req.url).origin).replace(/\/$/, "");
}

function clientId(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

type Options = { scope?: ApiScope };

/**
 * Every API route goes through here: rate limit, key check, scope check, one error shape, one version header.
 * Without a scope the route is public and read-only (published listings). With a scope it needs a key that has it.
 */
export async function apiRoute(req: Request, opts: Options, run: (c: { caller: ApiCaller | null; url: URL; origin: string }) => Promise<Response>) {
  try {
    const url = new URL(req.url);
    let caller: ApiCaller | null = null;
    if (opts.scope) {
      // Limit by network address first, so guessing keys is slow, then by key.
      if (!(await rateLimit(`api:ip:${clientId(req)}`, API_RATE_KEY_PER_MINUTE * 2, 60_000))) return apiError("rate_limited", { "Retry-After": "60" });
      caller = await authenticateApiKey(bearerFrom(req.headers.get("authorization")));
      if (!caller) return apiError("unauthorized", { "WWW-Authenticate": 'Bearer realm="api"' });
      if (!hasScope(caller.scopes.join(","), opts.scope)) return apiError("forbidden");
      if (!(await rateLimit(`api:key:${caller.keyId}`, API_RATE_KEY_PER_MINUTE, 60_000))) return apiError("rate_limited", { "Retry-After": "60" });
    } else if (!(await rateLimit(`api:public:${clientId(req)}`, API_RATE_PUBLIC_PER_MINUTE, 60_000))) {
      return apiError("rate_limited", { "Retry-After": "60" });
    }
    const res = await run({ caller, url, origin: originOf(req) });
    for (const [k, v] of Object.entries(base)) res.headers.set(k, v);
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", opts.scope ? "no-store" : "public, max-age=60");
    if (!opts.scope) res.headers.set("Access-Control-Allow-Origin", "*");
    return res;
  } catch {
    return apiError("server");
  }
}
