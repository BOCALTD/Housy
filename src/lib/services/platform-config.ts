/**
 * Settings the platform administrator controls from the dashboard (Admin → Settings):
 *  - Payments: Paystack keys for online payments. A key set on the server (PAYSTACK_SECRET_KEY) always wins over one saved here.
 *  - Person check: Google reCAPTCHA (v2 checkbox or v3 invisible) or Cloudflare Turnstile, its keys, and where it is asked.
 *  - Cloudflare: whether Housy sits behind Cloudflare, so the visitor's address is read from Cloudflare's header.
 *  - Commission: Housy's percentage of rent, inspection fees and other payments made through the platform.
 *  - Watermark: Housy's mark on public property photos (on by default), in a corner or across the middle.
 *  - Live chat: the support chat provider (Tawk.to, Crisp, Tidio or Intercom), its widget ID, and where it shows.
 *
 * Secret keys are stored encrypted (AES-256-GCM, the same as two-step sign-in secrets) and are never shown back in full.
 */
import { z } from "zod";
import { prisma, withPlatformAdmin } from "../db";
import { logActivity } from "../audit";
import { openSecret, sealSecret } from "../totp";
import { parsePercentToBps } from "../commission-rules";
import { COUNTRIES, COUNTRY_CODES, isCountry, providerCanServe, type Country, type OnlineProvider } from "../regions";

export const CAPTCHA_PROVIDERS = ["none", "recaptcha_v2", "recaptcha_v3", "turnstile"] as const;
export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number];
export const CAPTCHA_PLACES = ["signup", "login", "reset", "forms"] as const;
export type CaptchaPlace = (typeof CAPTCHA_PLACES)[number];
export const CAPTCHA_PLACE_LABELS: Record<CaptchaPlace, string> = { signup: "Creating an account", login: "Signing in", reset: "Resetting a password", forms: "Enquiry and contact forms" };
export const LIVE_CHAT_PROVIDERS = ["none", "tawk", "crisp", "tidio", "intercom"] as const;
export type LiveChatProvider = (typeof LIVE_CHAT_PROVIDERS)[number];
export const LIVE_CHAT_LABELS: Record<LiveChatProvider, string> = { none: "Off", tawk: "Tawk.to", crisp: "Crisp", tidio: "Tidio", intercom: "Intercom" };
export const LIVE_CHAT_PLACES = ["public", "me", "app"] as const;
export type LiveChatPlace = (typeof LIVE_CHAT_PLACES)[number];
export const LIVE_CHAT_PLACE_LABELS: Record<LiveChatPlace, string> = { public: "Public pages (visitors and signed-in people)", me: "Personal pages (seekers' and agents' own pages)", app: "Company and agent dashboards" };
/** Where each provider's widget ID is found, and what it looks like. */
export const LIVE_CHAT_ID_HINTS: Record<Exclude<LiveChatProvider, "none">, string> = {
  tawk: "Tawk.to: Administration, Chat Widget. Paste the direct chat link or the two IDs, for example 5f1a2b3c4d5e6f7a8b9c0d1e/1h2ij3kl4.",
  crisp: "Crisp: Settings, Website settings, Setup instructions. The Website ID, for example 1a2b3c4d-1234-5678-9abc-1234567890ab.",
  tidio: "Tidio: Settings, Developer. The public key (32 letters and digits).",
  intercom: "Intercom: Settings, Installation, Web. The workspace (app) ID, for example abc12def.",
};

/** A widget ID as the provider issues it, from whatever the administrator pasted (an embed link is accepted). Null when it is not one. */
export function liveChatId(provider: LiveChatProvider, raw: string): string | null {
  const t = raw.trim();
  if (provider === "tawk") {
    const m = t.match(/([a-f0-9]{24})\/([a-z0-9]{5,20})/i);
    return m ? `${m[1]}/${m[2]}` : null;
  }
  if (provider === "crisp") { const m = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); return m ? m[0].toLowerCase() : null; }
  if (provider === "tidio") { const m = t.match(/(?:^|\/)([a-z0-9]{32})(?:\.js)?$/i); return m ? m[1].toLowerCase() : null; }
  if (provider === "intercom") return /^[a-z0-9]{6,12}$/i.test(t) ? t.toLowerCase() : null;
  return null;
}

export const COMMISSION_KINDS = ["RENT", "INSPECTION", "OTHER"] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];
export const COMMISSION_LABELS: Record<CommissionKind, string> = { RENT: "Rent", INSPECTION: "Inspection fees", OTHER: "Other payments (service charge, deposits, fees)" };

const K = {
  paystackSecret: "paystack_secret", paystackPublic: "paystack_public",
  captchaProvider: "captcha_provider", captchaSiteKey: "captcha_site_key", captchaSecret: "captcha_secret", captchaPlaces: "captcha_places",
  trustCloudflare: "trust_cloudflare",
  stripeSecret: "stripe_secret", stripePublic: "stripe_public", stripeWebhook: "stripe_webhook_secret", paymentRoutes: "payment_routes",
  watermarkHousy: "watermark_housy", watermarkPosition: "watermark_position",
  liveChatProvider: "live_chat_provider", liveChatId: "live_chat_id", liveChatPlaces: "live_chat_places",
  commissionRent: "commission_rent_bps", commissionInspection: "commission_inspection_bps", commissionOther: "commission_other_bps",
} as const;

export type PlatformConfig = {
  paystack: { secret: string; public: string; source: "server" | "settings" | "none"; mode: "live" | "test" | null };
  stripe: { secret: string; public: string; webhook: string; source: "server" | "settings" | "none"; mode: "live" | "test" | null };
  /** Which online provider serves each country (the administrator's choice, or the usual one). */
  routes: Record<Country, OnlineProvider>;
  captcha: { provider: CaptchaProvider; siteKey: string; secret: string; places: CaptchaPlace[] };
  trustCloudflare: boolean;
  commissionBps: Record<CommissionKind, number>;
  liveChat: { provider: LiveChatProvider; id: string; places: LiveChatPlace[] };
  watermark: { housy: boolean; position: "corner" | "centre" };
};

let cache: { at: number; value: PlatformConfig } | null = null;

/** Saved routes over the usual ones; a provider that cannot serve a country is never chosen for it. */
function routesFrom(json: string | undefined): Record<Country, OnlineProvider> {
  let saved: Record<string, string> = {};
  try { saved = json ? JSON.parse(json) : {}; } catch { saved = {}; }
  return Object.fromEntries(COUNTRY_CODES.map((c) => {
    const want = saved[c];
    const p = (want === "PAYSTACK" || want === "STRIPE" || want === "NONE") && providerCanServe(want, c) ? want : COUNTRIES[c].online;
    return [c, p];
  })) as Record<Country, OnlineProvider>;
}
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
    stripe: (() => {
      const envS = process.env.STRIPE_SECRET_KEY ?? "", saved = open(v(K.stripeSecret)), sec = envS || saved;
      return { secret: sec, public: process.env.STRIPE_PUBLISHABLE_KEY || v(K.stripePublic) || "", webhook: process.env.STRIPE_WEBHOOK_SECRET || open(v(K.stripeWebhook)), source: envS ? "server" as const : saved ? "settings" as const : "none" as const, mode: sec.startsWith("sk_live_") ? "live" as const : sec.startsWith("sk_test_") ? "test" as const : null };
    })(),
    routes: routesFrom(v(K.paymentRoutes)),
    captcha: {
      provider, siteKey: v(K.captchaSiteKey) ?? "", secret: open(v(K.captchaSecret)),
      places: (v(K.captchaPlaces) ?? "signup,login,reset,forms").split(",").filter((p): p is CaptchaPlace => (CAPTCHA_PLACES as readonly string[]).includes(p)),
    },
    trustCloudflare: process.env.TRUST_CLOUDFLARE === "1" || v(K.trustCloudflare) === "1",
    watermark: { housy: v(K.watermarkHousy) !== "0", position: v(K.watermarkPosition) === "centre" ? "centre" : "corner" },
    liveChat: (() => {
      const pv = (LIVE_CHAT_PROVIDERS as readonly string[]).includes(v(K.liveChatProvider) ?? "") ? (v(K.liveChatProvider) as LiveChatProvider) : "none";
      const id = pv === "none" ? "" : liveChatId(pv, v(K.liveChatId) ?? "") ?? "";
      const places = (v(K.liveChatPlaces) ?? "public,me,app").split(",").filter((p): p is LiveChatPlace => (LIVE_CHAT_PLACES as readonly string[]).includes(p));
      return { provider: id ? pv : "none", id, places };
    })(),
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
    stripe: { source: c.stripe.source, mode: c.stripe.mode, secretTail: tail(c.stripe.secret), public: c.stripe.public, webhookSet: !!c.stripe.webhook },
    routes: c.routes,
    liveChat: c.liveChat,
    watermark: c.watermark,
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

const stripeSchema = z.object({
  secret: z.string().trim().refine((s) => s === "" || /^(sk|rk)_(test|live)_[A-Za-z0-9]{20,}$/.test(s), "The secret key starts with sk_live_ or sk_test_. Copy it from Stripe: Developers, API keys."),
  public: z.string().trim().refine((s) => s === "" || /^pk_(test|live)_[A-Za-z0-9]{20,}$/.test(s), "The publishable key starts with pk_live_ or pk_test_."),
  webhook: z.string().trim().refine((s) => s === "" || /^whsec_[A-Za-z0-9]{20,}$/.test(s), "The signing secret starts with whsec_. Copy it from Stripe: Developers, Webhooks, your endpoint."),
  clear: z.boolean().default(false),
});
/** Save Stripe keys. Empty fields keep what is saved; "clear" removes them. */
export async function saveStripeKeys(adminId: string, raw: z.input<typeof stripeSchema>) {
  const d = stripeSchema.parse(raw);
  if (d.clear) return save(adminId, [[K.stripeSecret, null], [K.stripePublic, null], [K.stripeWebhook, null]], "stripe", { cleared: true });
  if (d.secret && d.public && !d.secret.includes(d.public.slice(3, 7))) throw new Error("Use the secret and publishable keys from the same mode: both live or both test.");
  const entries: [string, string | null][] = [];
  if (d.secret) entries.push([K.stripeSecret, sealSecret(d.secret)]);
  if (d.public) entries.push([K.stripePublic, d.public]);
  if (d.webhook) entries.push([K.stripeWebhook, sealSecret(d.webhook)]);
  if (!entries.length) throw new Error("Enter the keys to save.");
  await save(adminId, entries, "stripe", { mode: d.secret.startsWith("sk_live_") ? "live" : d.secret ? "test" : "unchanged", webhook: !!d.webhook });
}

/** Which online provider serves each country. A provider that cannot work in a country is refused for it. */
export async function savePaymentRoutes(adminId: string, raw: Record<string, string>) {
  const out: Record<string, OnlineProvider> = {};
  for (const [c, p] of Object.entries(raw)) {
    if (!isCountry(c)) continue;
    if (p !== "PAYSTACK" && p !== "STRIPE" && p !== "NONE") throw new Error(`${COUNTRIES[c].name}: choose Paystack, Stripe or off.`);
    if (!providerCanServe(p, c)) throw new Error(`${p === "PAYSTACK" ? "Paystack" : "Stripe"} does not take payments in ${COUNTRIES[c].name}.`);
    out[c] = p;
  }
  await save(adminId, [[K.paymentRoutes, JSON.stringify(out)]], "payment_routes", out);
}

/** The online provider for a country, if it is switched on and its keys are set; null otherwise (bank transfer only). */
export async function onlineProviderFor(country: string): Promise<"PAYSTACK" | "STRIPE" | null> {
  const c = await platformConfig();
  const route = isCountry(country) ? c.routes[country] : "PAYSTACK";
  if (route === "PAYSTACK" && c.paystack.secret) return "PAYSTACK";
  if (route === "STRIPE" && c.stripe.secret && c.stripe.webhook) return "STRIPE";
  return null;
}

/** A payment provider by name, with the saved keys. */
export async function paymentProviderNamed(name: "PAYSTACK" | "STRIPE") {
  const { paystackProvider, stripeProvider } = await import("../payment-providers");
  const c = await platformConfig();
  if (name === "PAYSTACK") return c.paystack.secret ? paystackProvider(c.paystack.secret) : null;
  return c.stripe.secret && c.stripe.webhook ? stripeProvider(c.stripe.secret, c.stripe.webhook) : null;
}

const liveChatSchema = z.object({ provider: z.enum(LIVE_CHAT_PROVIDERS), id: z.string().trim().max(300), places: z.array(z.enum(LIVE_CHAT_PLACES)).default([]) });
/** Save the live chat. Turning it on needs the provider's widget ID and at least one place to show it. */
export async function saveLiveChat(adminId: string, raw: z.input<typeof liveChatSchema>) {
  const d = liveChatSchema.parse(raw);
  if (d.provider === "none") return save(adminId, [[K.liveChatProvider, "none"]], "live_chat", { provider: "none" });
  const id = liveChatId(d.provider, d.id);
  if (!id) throw new Error(`That does not look like a ${LIVE_CHAT_LABELS[d.provider]} widget ID. ${LIVE_CHAT_ID_HINTS[d.provider]}`);
  if (!d.places.length) throw new Error("Choose at least one place to show the chat, or turn it off.");
  await save(adminId, [[K.liveChatProvider, d.provider], [K.liveChatId, id], [K.liveChatPlaces, d.places.join(",")]], "live_chat", { provider: d.provider, places: d.places });
}

/** Where a page is, for the live chat's places: admin pages never show it. */
export function liveChatPlaceOf(path: string): LiveChatPlace | null {
  if (path.startsWith("/admin") || path.startsWith("/qa")) return null;
  if (path.startsWith("/app") || path.startsWith("/provider")) return "app";
  if (path.startsWith("/me")) return "me";
  return "public";
}

/** Housy's mark on public property photos: on or off, and where. */
export async function saveWatermark(adminId: string, raw: { housy: boolean; position: string }) {
  const position = raw.position === "centre" ? "centre" : "corner";
  await save(adminId, [[K.watermarkHousy, raw.housy ? "1" : "0"], [K.watermarkPosition, position]], "watermark", { housy: raw.housy, position });
}
