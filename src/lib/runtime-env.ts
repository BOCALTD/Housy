/**
 * Connections and site details the platform administrator manages in Admin, Connections, instead of editing the server's
 * settings file: outgoing email, the AI assistant, identity checks, push notifications, contact and legal details, maps and
 * routing, verification timings, and the two-step sign-in rule.
 *
 * Each value is saved as a platform setting ("cfg:<NAME>"); secret ones are encrypted (with MFA_ENCRYPTION_KEY) and never shown
 * again whole. A value set in the server's settings file still wins, and the page says so.
 *
 * Code reads them through envNow(): the server's settings with the saved values filled in. The saved values are loaded when the
 * server starts, every 30 seconds after, and straight after a save, so most code can stay synchronous. Paths that send something
 * (email, texts, pushes, identity checks) call loadRuntimeEnv() first to be sure they have the latest.
 */
import { generateKeyPairSync } from "node:crypto";
import { prisma, withPlatformAdmin } from "./db";
import { logActivity } from "./audit";
import { openSecret, sealSecret } from "./totp";

export type Kind = "text" | "secret" | "email" | "url" | "number" | "bool" | "select" | "textarea";
export type Managed = { name: string; label: string; group: Group; kind: Kind; hint?: string; options?: [string, string][]; check?: (v: string) => string | null; placeholder?: string };
export type Group = "email" | "contact" | "ai" | "identity" | "push" | "maps" | "google" | "verification" | "security";

const emailOk = (v: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : "Enter an email address");
const fromOk = (v: string) => (/^([^<>]{1,80}<)?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/.test(v.trim()) ? null : "Enter the sender as name@yourdomain.com, or Housy <name@yourdomain.com>");
const httpsOk = (v: string) => (/^https:\/\/[^\s]+$/.test(v) ? null : "Enter an address starting with https://");
const tilesOk = (v: string) => (/^https:\/\/.+\{z\}.+\{x\}.+\{y\}/.test(v) ? null : "Enter the tile address with {z}, {x} and {y} in it, starting with https://");
const intIn = (lo: number, hi: number) => (v: string) => (/^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? null : `Enter a whole number from ${lo} to ${hi}`);

export const MANAGED: Managed[] = [
  // Outgoing email
  { name: "EMAIL_PROVIDER", label: "Send email with", group: "email", kind: "select", options: [["", "Not connected"], ["resend", "Resend"], ["smtp", "SMTP (your email host)"]] },
  { name: "EMAIL_FROM", label: "Send from", group: "email", kind: "text", check: fromOk, placeholder: "Housy <hello@yourdomain.com>", hint: "An address on a domain you have verified with the provider." },
  { name: "EMAIL_REPLY_TO", label: "Replies go to (optional)", group: "email", kind: "email", check: emailOk },
  { name: "RESEND_API_KEY", label: "Resend API key", group: "email", kind: "secret", check: (v) => (/^re_[A-Za-z0-9_]{10,}$/.test(v) ? null : "Paste the Resend key (it starts with re_)") },
  { name: "SMTP_HOST", label: "SMTP server", group: "email", kind: "text", check: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : "Enter the server name, such as smtp.zoho.com"), placeholder: "smtp.yourhost.com" },
  { name: "SMTP_PORT", label: "SMTP port", group: "email", kind: "number", check: intIn(1, 65535), placeholder: "465", hint: "465 (secure) or 587 (upgraded to secure)." },
  { name: "SMTP_USER", label: "SMTP user name", group: "email", kind: "text" },
  { name: "SMTP_PASSWORD", label: "SMTP password", group: "email", kind: "secret" },
  // Contact and legal details
  { name: "SUPPORT_EMAIL", label: "Support email", group: "contact", kind: "email", check: emailOk },
  { name: "SUPPORT_PHONE", label: "Support phone", group: "contact", kind: "text", check: (v) => (/^[+0-9 ()-]{6,24}$/.test(v) ? null : "Enter the phone number with its country code") },
  { name: "SUPPORT_HOURS", label: "Support hours", group: "contact", kind: "text", placeholder: "Monday to Friday, 9am to 5pm WAT" },
  { name: "PRIVACY_EMAIL", label: "Privacy email", group: "contact", kind: "email", check: emailOk, hint: "For data requests. The support email is used when empty." },
  { name: "LEGAL_ENTITY_NAME", label: "Registered name of the operator", group: "contact", kind: "text", hint: "The company that runs the platform, as registered." },
  { name: "LEGAL_ADDRESS", label: "Registered address", group: "contact", kind: "textarea" },
  // AI assistant
  { name: "ANTHROPIC_API_KEY", label: "Anthropic API key", group: "ai", kind: "secret", check: (v) => (/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v) ? null : "Paste the key from the Anthropic console (it starts with sk-ant-)") },
  { name: "AI_MODEL", label: "Model", group: "ai", kind: "text", placeholder: "claude-sonnet-4-5", check: (v) => (/^[a-z0-9.-]{3,60}$/.test(v) ? null : "Enter a model name, such as claude-sonnet-4-5") },
  // Identity checks
  { name: "DOJAH_APP_ID", label: "Dojah app ID", group: "identity", kind: "text" },
  { name: "DOJAH_SECRET_KEY", label: "Dojah secret key", group: "identity", kind: "secret" },
  { name: "YOUVERIFY_TOKEN", label: "Youverify token", group: "identity", kind: "secret" },
  { name: "KYC_PROVIDERS", label: "Order to try them", group: "identity", kind: "select", options: [["", "Dojah, then Youverify"], ["youverify,dojah", "Youverify, then Dojah"], ["dojah", "Dojah only"], ["youverify", "Youverify only"]] },
  // Push notifications
  { name: "VAPID_PUBLIC_KEY", label: "Public key", group: "push", kind: "text" },
  { name: "VAPID_PRIVATE_KEY", label: "Private key", group: "push", kind: "secret" },
  { name: "VAPID_SUBJECT", label: "Contact for push services", group: "push", kind: "text", check: (v) => (/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(v) ? null : "Enter mailto:you@yourdomain.com or an https:// address") },
  // Maps and routing
  { name: "NEXT_PUBLIC_MAP_TILES", label: "Map tiles", group: "maps", kind: "url", check: tilesOk, placeholder: "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=…" },
  { name: "NEXT_PUBLIC_MAP_ATTRIBUTION", label: "Map credit", group: "maps", kind: "text", placeholder: "© MapTiler © OpenStreetMap contributors" },
  { name: "NEXT_PUBLIC_MAP_SATELLITE_TILES", label: "Satellite tiles (optional)", group: "maps", kind: "url", check: tilesOk },
  { name: "NEXT_PUBLIC_MAP_SATELLITE_TILE_SIZE", label: "Satellite tile size", group: "maps", kind: "select", options: [["", "256"], ["512", "512"]] },
  { name: "NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION", label: "Satellite credit", group: "maps", kind: "text" },
  { name: "NEARBY_PLACES", label: "Nearby places on listings", group: "maps", kind: "select", options: [["", "On"], ["off", "Off"]] },
  { name: "OVERPASS_URL", label: "Your own Overpass server (optional)", group: "maps", kind: "url", check: (v) => (v.split(",").every((x) => !httpsOk(x.trim())) ? null : "Enter https:// addresses, separated by commas") },
  { name: "OVERPASS_CONTACT", label: "Contact sent to the Overpass server", group: "maps", kind: "text" },
  { name: "ROUTING_URL", label: "Routing server for travel times (optional)", group: "maps", kind: "url", check: httpsOk, hint: "An OSRM-compatible server. Without one, travel times are estimates." },
  // Google
  { name: "NEXT_PUBLIC_GOOGLE_CLIENT_ID", label: "Google client ID (for saving files to Google Drive)", group: "google", kind: "text", check: (v) => (/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v) ? null : "Paste the OAuth client ID ending in .apps.googleusercontent.com") },
  // Verification nudges
  { name: "VERIFY_DECLINE_DAYS", label: "Days before asking again after someone declines", group: "verification", kind: "number", check: intIn(1, 730), placeholder: "90" },
  { name: "VERIFY_LATER_HOURS", label: "Hours before asking again after \"later\"", group: "verification", kind: "number", check: intIn(1, 720), placeholder: "24" },
  { name: "VERIFY_RECOMMEND_RENTALS", label: "Also suggest checks for rentals", group: "verification", kind: "bool" },
  // Security
  { name: "REQUIRE_ADMIN_MFA", label: "Platform administrators must use two-step sign-in", group: "security", kind: "bool" },
];

export const GROUPS: Record<Group, { title: string; intro: string }> = {
  email: { title: "Outgoing email", intro: "Sign-in codes, notices, receipts and digests. Choose Resend, or the SMTP server of your email host (Zoho, Google Workspace, Microsoft 365, cPanel mail)." },
  contact: { title: "Contact and legal details", intro: "Shown on the support page, in emails and in the built-in legal text." },
  ai: { title: "AI assistant", intro: "Optional. Without a key, every feature uses the built-in rules." },
  identity: { title: "Identity checks", intro: "Optional. With keys, NIN, company registration and tax numbers people agree to are checked against the official record automatically; without, a person checks them." },
  push: { title: "Push notifications", intro: "Notices on phones and computers. Make keys once and keep them: changing them makes every device turn notifications on again." },
  maps: { title: "Maps and nearby places", intro: "Without a tile provider, OpenStreetMap's public tiles are used, which are for testing and light use only." },
  google: { title: "Google", intro: "Optional." },
  verification: { title: "Verification suggestions", intro: "When people are reminded to verify properties." },
  security: { title: "Sign-in security", intro: "" },
};

const PREFIX = "cfg:";
let saved: Record<string, string> = {};
let loadedAt = 0;
let loading: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;

const MANAGED_NAMES = new Set(MANAGED.map((m) => m.name));
const isSecret = (name: string) => MANAGED.find((m) => m.name === name)?.kind === "secret";
const fromServer = (name: string) => (process.env[name] ?? "").trim() !== "";

/** Read the saved values (at most every few seconds unless forced). */
export async function loadRuntimeEnv(force = false) {
  if (!force && Date.now() - loadedAt < 5_000) return;
  loading ??= (async () => {
    try {
      const rows = await prisma.platformSetting.findMany({ where: { key: { startsWith: PREFIX } } });
      const next: Record<string, string> = {};
      for (const r of rows) {
        const name = r.key.slice(PREFIX.length);
        if (!MANAGED_NAMES.has(name) || !r.value) continue;
        try { next[name] = isSecret(name) ? openSecret(r.value) : r.value; } catch { /* a value sealed with another key is ignored */ }
      }
      saved = next;
      loadedAt = Date.now();
    } catch { /* the database is not reachable yet; keep what we had */ }
  })().finally(() => { loading = null; });
  await loading;
  if (!timer && process.env.NODE_ENV !== "test") {
    timer = setInterval(() => { void loadRuntimeEnv(true); }, 30_000);
    timer.unref?.();
  }
}

/** The server's settings with the administrator's saved values filled in (the server's own value wins when both exist). */
export function envNow(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...process.env };
  for (const [k, v] of Object.entries(saved)) if (!fromServer(k)) out[k] = v;
  return out;
}

/** envNow() after making sure the saved values are fresh. */
export async function runtimeEnv() { await loadRuntimeEnv(); return envNow(); }

/** One setting, for code that needs a single value. */
export const envValue = (name: string) => envNow()[name]?.trim() ?? "";

export type AdminField = Managed & { value: string; tail: string; server: boolean; set: boolean };

export async function managedForAdmin(): Promise<Record<Group, AdminField[]>> {
  await loadRuntimeEnv(true);
  const out = {} as Record<Group, AdminField[]>;
  for (const m of MANAGED) {
    const server = fromServer(m.name);
    const v = server ? (process.env[m.name] ?? "").trim() : saved[m.name] ?? "";
    const field: AdminField = { ...m, check: undefined, server, set: v !== "", value: m.kind === "secret" ? "" : v, tail: m.kind === "secret" && v ? `…${v.slice(-4)}` : "" };
    (out[m.group] ??= []).push(field);
  }
  return out;
}

/**
 * Save a group's values. Empty secret fields keep the saved secret unless "clear" lists them. Values set on the server cannot be
 * changed here. Returns the names that changed.
 */
export async function saveManaged(adminId: string, group: Group, values: Record<string, string>, clear: string[] = []) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  await loadRuntimeEnv(true);
  const changes: [string, string][] = [];
  for (const m of MANAGED.filter((x) => x.group === group)) {
    if (fromServer(m.name)) continue;
    let v = (values[m.name] ?? "").trim();
    if (m.kind === "bool") v = values[m.name] === "on" || values[m.name] === "true" ? "true" : "";
    if (m.kind === "secret" && !v) { if (clear.includes(m.name) && saved[m.name]) changes.push([m.name, ""]); continue; }
    if (v && m.check) { const err = m.check(v); if (err) throw new Error(`${m.label}: ${err}`); }
    if (m.kind === "select" && m.options && !m.options.some(([o]) => o === v)) throw new Error(`${m.label}: choose one of the options`);
    if (v.length > 2000) throw new Error(`${m.label} is too long`);
    if ((saved[m.name] ?? "") !== v) changes.push([m.name, v]);
  }
  if (group === "email") checkEmailGroup({ ...saved, ...Object.fromEntries(changes) });
  if (!changes.length) return [];
  await withPlatformAdmin(adminId, async (tx) => {
    for (const [name, v] of changes) {
      const key = PREFIX + name;
      if (!v) { await tx.platformSetting.deleteMany({ where: { key } }); continue; }
      const value = isSecret(name) ? sealSecret(v) : v;
      await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: `connections:${group}`, action: "settings.connections", detail: { group, changed: changes.map(([n]) => n) } });
  });
  await loadRuntimeEnv(true);
  return changes.map(([n]) => n);
}

function checkEmailGroup(v: Record<string, string>) {
  const p = fromServer("RESEND_API_KEY") ? "resend" : v.EMAIL_PROVIDER ?? "";
  if (!p) return;
  if (!(v.EMAIL_FROM || fromServer("EMAIL_FROM"))) throw new Error("Enter the address emails are sent from");
  if (p === "resend" && !(v.RESEND_API_KEY || fromServer("RESEND_API_KEY"))) throw new Error("Enter the Resend API key");
  if (p === "smtp" && !(v.SMTP_HOST && v.SMTP_USER && v.SMTP_PASSWORD)) throw new Error("Enter the SMTP server, user name and password");
}

/** New push notification keys (P-256), saved straight away. Every device must turn notifications on again afterwards. */
export function newPushKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };
  return { publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]).toString("base64url"), privateKey: priv.d };
}

export async function makePushKeys(adminId: string) {
  const { publicKey: raw, privateKey } = newPushKeys();
  const priv = { d: privateKey };
  const support = envValue("SUPPORT_EMAIL");
  await saveManaged(adminId, "push", { VAPID_PUBLIC_KEY: raw, VAPID_PRIVATE_KEY: priv.d, VAPID_SUBJECT: envValue("VAPID_SUBJECT") || (support ? `mailto:${support}` : "") });
  return raw;
}

/** For tests: forget loaded values. */
export function _resetRuntimeEnv() { saved = {}; loadedAt = 0; }
