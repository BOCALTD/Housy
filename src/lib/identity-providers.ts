/**
 * Licensed identity-check providers, used to confirm KYC details against official records (NIMC, INEC, FRSC, CAC, FIRS).
 * Each is switched on only by its own keys, which belong to the platform owner's account with that provider; nothing here
 * has a default key. Several can be configured: they are tried in the order given in KYC_PROVIDERS, and when none can give
 * an answer the check goes to a person on the verification team.
 *
 * Endpoints follow the providers' public documentation:
 *  - Dojah: https://docs.dojah.io (GET /api/v1/kyc/nin, /api/v1/kyc/cac/basic, /api/v1/kyc/cac/tin; headers AppId and Authorization)
 *  - Youverify: https://doc.youverify.co (POST /v2/api/identity/ng/nin, /pvc, /drivers-license; header token; subject consent required)
 */
import type { Lookup } from "./kyc-auto-rules";

/** What a provider found. Only the fields needed for the comparison are kept; photos, dates of birth and phone numbers are dropped. */
export type Found =
  | { found: false; reference: string }
  | { found: true; reference: string; person?: { first: string; middle: string; last: string }; company?: { name: string; status: string; taxId?: string } };

export interface IdentityProvider {
  name: string;
  supports: (lookup: Lookup) => boolean;
  /** Throws ProviderUnavailable when the provider cannot give an answer (down, slow, keys refused, out of credit). */
  lookup: (lookup: Lookup, input: { number: string; companyType?: string; firstName?: string; lastName?: string }) => Promise<Found>;
}

export class ProviderUnavailable extends Error {}

type Env = Record<string, string | undefined>;
const TIMEOUT_MS = 15_000;

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  } catch (e) {
    throw new ProviderUnavailable((e as Error).name === "AbortError" ? "the provider did not answer in time" : "the provider could not be reached");
  } finally { clearTimeout(t); }
}

const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A 4xx that means "no such record" rather than a problem with our request or keys. */
function notFoundish(status: number, body: Record<string, unknown>) {
  const text = JSON.stringify(body).toLowerCase();
  return status === 404 || (status === 400 && /not found|no record|invalid (nin|rc|number|id)|does not exist/.test(text));
}

export function dojah(env: Env): IdentityProvider | null {
  const appId = env.DOJAH_APP_ID, key = env.DOJAH_SECRET_KEY;
  if (!appId || !key) return null;
  const base = (env.DOJAH_BASE_URL || "https://api.dojah.io").replace(/\/+$/, "");
  const headers = { AppId: appId, Authorization: key, Accept: "application/json" };
  return {
    name: "Dojah",
    supports: (l) => l === "NIN" || l === "CAC" || l === "TIN",
    async lookup(l, input) {
      const q = l === "NIN" ? `/api/v1/kyc/nin?nin=${encodeURIComponent(input.number)}`
        : `/api/v1/kyc/cac/${l === "CAC" ? "basic" : "tin"}?rc_number=${encodeURIComponent(input.number)}&company_type=${encodeURIComponent(input.companyType ?? "COMPANY")}`;
      const { status, body } = await call(base + q, { method: "GET", headers });
      if (notFoundish(status, body)) return { found: false, reference: "" };
      if (status < 200 || status >= 300) throw new ProviderUnavailable(status === 401 || status === 403 ? "the provider refused the keys" : status === 402 ? "the provider account is out of credit" : `the provider answered ${status}`);
      const e = obj(body.entity);
      if (!Object.keys(e).length) return { found: false, reference: "" };
      if (l === "NIN") return { found: true, reference: "", person: { first: s(e.first_name), middle: s(e.middle_name), last: s(e.last_name) } };
      return { found: true, reference: s(e.rc_number), company: { name: s(e.company_name), status: s(e.status), taxId: l === "TIN" ? s(e.tax_id) : undefined } };
    },
  };
}

export function youverify(env: Env): IdentityProvider | null {
  const token = env.YOUVERIFY_TOKEN;
  if (!token) return null;
  const base = (env.YOUVERIFY_BASE_URL || "https://api.youverify.co").replace(/\/+$/, "");
  const path: Partial<Record<Lookup, string>> = { NIN: "nin", PVC: "pvc", DRIVERS_LICENCE: "drivers-license" };
  return {
    name: "Youverify",
    supports: (l) => !!path[l],
    async lookup(l, input) {
      const { status, body } = await call(`${base}/v2/api/identity/ng/${path[l]}`, {
        method: "POST",
        headers: { token, "Content-Type": "application/json", Accept: "application/json" },
        // Only asked when the person ticked the box to have their details checked automatically.
        body: JSON.stringify({ id: input.number, isSubjectConsent: true }),
      });
      if (notFoundish(status, body)) return { found: false, reference: "" };
      if (status < 200 || status >= 300) throw new ProviderUnavailable(status === 401 || status === 403 ? "the provider refused the token" : status === 402 ? "the provider account is out of credit" : `the provider answered ${status}`);
      const d = obj(body.data);
      if (s(d.status).toLowerCase() !== "found") return { found: false, reference: s(d.id) };
      return { found: true, reference: s(d.id), person: { first: s(d.firstName), middle: s(d.middleName), last: s(d.lastName) } };
    },
  };
}

let override: IdentityProvider[] | null = null;
/** Tests replace the real providers with fakes. */
export function setIdentityProvidersForTests(list: IdentityProvider[] | null) { override = list; }

/** The configured providers, in the order to try them. KYC_PROVIDERS="dojah,youverify"; unset means every one that has keys. */
export function identityProviders(env: Env = process.env): IdentityProvider[] {
  if (override) return override;
  const all: Record<string, IdentityProvider | null> = { dojah: dojah(env), youverify: youverify(env) };
  const order = (env.KYC_PROVIDERS || "dojah,youverify").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return order.map((k) => all[k]).filter((p): p is IdentityProvider => !!p);
}

/** Whether any configured provider could check this kind of record. */
export const canAutoCheck = (l: Lookup, env: Env = process.env) => identityProviders(env).some((p) => p.supports(l));
