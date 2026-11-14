/**
 * Settings the platform administrator controls from the dashboard (Admin → Settings):
 *  - Payments: Paystack keys for online payments. A key set on the server (PAYSTACK_SECRET_KEY) always wins over one saved here.
 *  - Person check: Google reCAPTCHA (v2 checkbox or v3 invisible) or Cloudflare Turnstile, its keys, and where it is asked.
 *  - Cloudflare: whether Housy sits behind Cloudflare, so the visitor's address is read from Cloudflare's header.
 *  - Commission: Housy's percentage of rent, inspection fees and other payments made through the platform.
 *
 * Secret keys are stored encrypted (AES-256-GCM, the same as two-step sign-in secrets) and are never shown back in full.
 */
import { z } from "zod";
import { prisma, withPlatformAdmin } from "../db";
import { logActivity } from "../audit";
import { openSecret, sealSecret } from "../totp";
import { parsePercentToBps } from "../commission-rules";

export const CAPTCHA_PROVIDERS = ["none", "recaptcha_v2", "recaptcha_v3", "turnstile"] as const;
export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number];
export const CAPTCHA_PLACES = ["signup", "login", "reset", "forms"] as const;
export type CaptchaPlace = (typeof CAPTCHA_PLACES)[number];
export const CAPTCHA_PLACE_LABELS: Record<CaptchaPlace, string> = { signup: "Creating an account", login: "Signing in", reset: "Resetting a password", forms: "Enquiry and contact forms" };
export const COMMISSION_KINDS = ["RENT", "INSPECTION", "OTHER"] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];
export const COMMISSION_LABELS: Record<CommissionKind, string> = { RENT: "Rent", INSPECTION: "Inspection fees", OTHER: "Other payments (service charge, deposits, fees)" };

const K = {
  paystackSecret: "paystack_secret", paystackPublic: "paystack_public",
  captchaProvider: "captcha_provider", captchaSiteKey: "captcha_site_key", captchaSecret: "captcha_secret", captchaPlaces: "captcha_places",
  trustCloudflare: "trust_cloudflare",
  commissionRent: "commission_rent_bps", commissionInspection: "commission_inspection_bps", commissionOther: "commission_other_bps",
} as const;

export type PlatformConfig = {
  paystack: { secret: string; public: string; source: "server" | "settings" | "none"; mode: "live" | "test" | null };
  captcha: { provider: CaptchaProvider; siteKey: string; secret: string; places: CaptchaPlace[] };
  trustCloudflare: boolean;
  commissionBps: Record<CommissionKind, number>;
};

let cache: { at: number; value: PlatformConfig } | null = null;
const TTL = 30_000;

const open = (v: string | undefined) => { if (!v) return ""; try { return openSecret(v); } catch { return ""; } };
const bps = (v: string | undefined) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 5000 ? n : 0; };

/** The current settings, cached for a few seconds. Server settings (environment) take priority where they exist. */
export async function platformConfig(): Promise<PlatformConfig> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: Object.values(K) } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  const envSecret = process.env.PAYSTACK_SECRET_KEY ?? "";
  const savedSecret = open(v(K.paystackSecret));
  const secret = envSecret || savedSecret;
  const provider = (CAPTCHA_PROVIDERS as readonly string[]).includes(v(K.captchaProvider) ?? "") ? (v(K.captchaProvider) as CaptchaProvider) : "none";
  const value: PlatformConfig = {
    paystack: {
      secret, public: process.env.PAYSTACK_PUBLIC_KEY || v(K.paystackPublic) || "",
      source: envSecret ? "server" : savedSecret ? "settings" : "none",
      mode: secret.startsWith("sk_live_") ? "live" : secret.startsWith("sk_test_") ? "test" : null,
    },
    captcha: {
      provider, siteKey: v(K.captchaSiteKey) ?? "", secret: open(v(K.captchaSecret)),
      places: (v(K.captchaPlaces) ?? "signup,login,reset,forms").split(",").filter((p): p is CaptchaPlace => (CAPTCHA_PLACES as readonly string[]).includes(p)),
    },
    trustCloudflare: process.env.TRUST_CLOUDFLARE === "1" || v(K.trustCloudflare) === "1",
    commissionBps: { RENT: bps(v(K.commissionRent)), INSPECTION: bps(v(K.commissionInspection)), OTHER: bps(v(K.commissionOther)) },
  };
  cache = { at: Date.now(), value };
  return value;
}
export function forgetPlatformConfig() { cache = null; }

/** What the settings page shows: never a whole secret, only whether one is saved and its last four characters. */
export async function configForAdmin() {
  const c = await platformConfig();
  const tail = (s: string) => (s ? `••••${s.slice(-4)}` : "");
  return {
    paystack: { source: c.paystack.source, mode: c.paystack.mode, secretTail: tail(c.paystack.secret), public: c.paystack.public },
    captcha: { provider: c.captcha.provider, siteKey: c.captcha.siteKey, secretTail: tail(c.captcha.secret), places: c.captcha.places },
    trustCloudflare: c.trustCloudflare, trustCloudflareFromServer: process.env.TRUST_CLOUDFLARE === "1",
    commission: Object.fromEntries(COMMISSION_KINDS.map((k) => [k, (c.commissionBps[k] / 100).toString()])) as Record<CommissionKind, string>,
  };
}

async function save(adminId: string, entries: [string, string | null][], what: string, detail: Record<string, unknown>) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  await withPlatformAdmin(adminId, async (tx) => {
    for (const [key, value] of entries) {
      if (value === null) await tx.platformSetting.deleteMany({ where: { key } });
      else await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: what, action: `settings.${what}`, detail });
  });
  forgetPlatformConfig();
}

const paystackSchema = z.object({
  secret: z.string().trim().refine((s) => s === "" || /^sk_(test|live)_[A-Za-z0-9]{20,}$/.test(s), "The secret key starts with sk_live_ or sk_test_. Copy it from Paystack: Settings, API Keys & Webhooks."),
  public: z.string().trim().refine((s) => s === "" || /^pk_(test|live)_[A-Za-z0-9]{20,}$/.test(s), "The public key starts with pk_live_ or pk_test_."),
  clear: z.boolean().default(false),
});
/** Save Paystack keys. An empty secret keeps the one saved; "clear" removes the saved keys. */
export async function savePaystackKeys(adminId: string, raw: z.input<typeof paystackSchema>) {
  const d = paystackSchema.parse(raw);
  if (d.clear) return save(adminId, [[K.paystackSecret, null], [K.paystackPublic, null]], "paystack", { cleared: true });
  if (d.secret && d.public && d.secret.slice(3, 7) !== d.public.slice(3, 7)) throw new Error("Use the secret and public keys from the same mode: both live or both test.");
  const entries: [string, string | null][] = [];
  if (d.secret) entries.push([K.paystackSecret, sealSecret(d.secret)]);
  if (d.public) entries.push([K.paystackPublic, d.public]);
  if (!entries.length) throw new Error("Enter the keys to save.");
  await save(adminId, entries, "paystack", { mode: d.secret.startsWith("sk_live_") ? "live" : d.secret ? "test" : "unchanged" });
}

const captchaSchema = z.object({
  provider: z.enum(CAPTCHA_PROVIDERS),
  siteKey: z.string().trim().max(200),
  secret: z.string().trim().max(200),
  places: z.array(z.enum(CAPTCHA_PLACES)).default([]),
});
/** Save the person check. Turning one on needs its site key and secret key (an empty secret keeps the saved one). */
export async function saveCaptcha(adminId: string, raw: z.input<typeof captchaSchema>) {
  const d = captchaSchema.parse(raw);
  const current = await platformConfig();
  if (d.provider !== "none") {
    if (d.siteKey.length < 20) throw new Error("Enter the site key from the provider's dashboard.");
    if (!d.secret && !current.captcha.secret) throw new Error("Enter the secret key from the provider's dashboard.");
    if (d.secret && d.secret.length < 20) throw new Error("That secret key looks too short. Copy it again from the provider's dashboard.");
    if (!d.places.length) throw new Error("Choose at least one place to ask for the check, or turn it off.");
  }
  const entries: [string, string | null][] = [[K.captchaProvider, d.provider], [K.captchaSiteKey, d.siteKey], [K.captchaPlaces, d.places.join(",")]];
  if (d.secret) entries.push([K.captchaSecret, sealSecret(d.secret)]);
  await save(adminId, entries, "captcha", { provider: d.provider, places: d.places });
}

export async function saveCloudflare(adminId: string, trust: boolean) {
  await save(adminId, [[K.trustCloudflare, trust ? "1" : "0"]], "cloudflare", { trust });
}

/** Housy's commission percentages, 0% to 50%, to two decimal places. They apply to payments made after the change. */
export async function saveCommission(adminId: string, raw: Record<CommissionKind, string>) {
  const out: [string, string][] = [];
  const keyOf: Record<CommissionKind, string> = { RENT: K.commissionRent, INSPECTION: K.commissionInspection, OTHER: K.commissionOther };
  for (const k of COMMISSION_KINDS) {
    let b: number;
    const t = (raw[k] ?? "").trim().replace(/%$/, "");
    try { b = /^0*(\.0*)?$/.test(t) ? 0 : parsePercentToBps(t); } catch { throw new Error(`${COMMISSION_LABELS[k]}: enter a percentage, for example 5 or 2.5.`); }
    if (b > 5000) throw new Error(`${COMMISSION_LABELS[k]}: the commission cannot be more than 50%.`);
    out.push([keyOf[k], String(b)]);
  }
  await save(adminId, out, "commission", Object.fromEntries(out));
}

/** The connected payment provider: Paystack with the server's key, or the key saved in settings; null when neither is set. */
export async function activePaymentProvider() {
  const { paystackProvider } = await import("../payment-providers");
  const c = await platformConfig();
  return c.paystack.secret ? paystackProvider(c.paystack.secret) : null;
}
