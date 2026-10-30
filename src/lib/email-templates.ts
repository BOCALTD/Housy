import { BRAND } from "./brand";
import { PLATFORM_NAME } from "./labels";
// Reusable email templates. Each template turns a small set of values into a subject, plain text and HTML. Values are always
// escaped, subjects cannot carry line breaks, and links must be web addresses or paths on this site.

export interface Rendered { subject: string; text: string; html: string }
export interface Layout { baseUrl: string; platform: string; recipientName: string; unsubscribeUrl: string | null; settingsUrl: string }
type V = Record<string, unknown>;
interface Body { subject: string; heading: string; lines: string[]; cta?: { label: string; path: string } }

const s = (v: unknown, max = 300) => (typeof v === "string" ? v : v == null ? "" : String(v)).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const money = (kobo: unknown) => { const n = Number(kobo); return Number.isFinite(n) && n > 0 ? `₦${Math.round(n / 100).toLocaleString("en-NG")}` : ""; };

/** Only http(s) links, or a path that starts with a single slash, are ever put into an email. */
export function safeLink(base: string, link: string): string | null {
  const l = link.trim();
  if (!l) return null;
  if (/^https?:\/\//i.test(l)) return l;
  return l.startsWith("/") && !l.startsWith("//") ? `${base.replace(/\/+$/, "")}${l}` : null;
}

export const TEMPLATES: Record<string, (v: V) => Body> = {
  generic: (v) => ({ subject: s(v.title, 160) || "A notice from us", heading: s(v.title, 160), lines: [s(v.body, 600)].filter(Boolean), cta: v.link ? { label: s(v.cta) || "Open", path: s(v.link, 300) } : undefined }),
  welcome: (v) => {
    const k = s(v.kind);
    const line = k === "company" ? "Your company workspace is ready. Add your team, your properties and your first listing when you are ready."
      : k === "agent" ? "Your agent workspace is ready. Finish your profile and verification so clients can find and trust you, then add your first listing."
      : "Your account is ready. Browse homes, follow agents you like and save a search to be told about new matches.";
    return {
      subject: `Welcome to ${PLATFORM_NAME}, ${s(v.name, 60) || "there"}`, heading: "Welcome",
      lines: [line, "You decide which emails you get from your notification settings."],
      cta: { label: k === "company" || k === "agent" ? "Open your workspace" : "Find a home", path: k === "company" || k === "agent" ? "/app" : "/" },
    };
  },
  enquiry_received: (v) => ({ subject: `New enquiry about ${s(v.listing, 120)}`, heading: "You have a new enquiry", lines: [`${s(v.from, 80)} asked about ${s(v.listing, 120)}.`, s(v.message, 400)].filter(Boolean), cta: { label: "Open enquiries", path: "/app/crm" } }),
  property_alert: (v) => ({
    subject: `New match: ${s(v.title, 120)}`, heading: "A new property matches what you asked for",
    lines: [s(v.title, 160), [s(v.city), money(v.priceKobo), v.bedrooms != null ? `${s(v.bedrooms)} bed` : ""].filter(Boolean).join(" · "), s(v.reason) ? `Why you are seeing this: ${s(v.reason)}` : ""].filter(Boolean),
    cta: { label: "View the property", path: s(v.link, 300) || "/" },
  }),
  availability_alert: (v) => ({ subject: `${s(v.title, 120)}: ${s(v.change, 60) || "update"}`, heading: "A property you are watching has changed", lines: [s(v.title, 160), s(v.change, 200)].filter(Boolean), cta: { label: "View the property", path: s(v.link, 300) || "/" } }),
  new_agent: (v) => ({ subject: `New in ${s(v.city, 60) || "your area"}: ${s(v.name, 80)}`, heading: "A new agent or company near you", lines: [`${s(v.name, 80)} has joined the directory${v.city ? ` in ${s(v.city, 60)}` : ""}.`], cta: { label: "See the profile", path: s(v.link, 300) || "/directory" } }),
  rent_reminder: (v) => ({ subject: `Rent reminder: ${s(v.property, 120)}`, heading: "Rent is due soon", lines: [`Rent for ${s(v.property, 120)} is due on ${s(v.due, 40)}.`, money(v.amountKobo) ? `Amount: ${money(v.amountKobo)}` : ""].filter(Boolean), cta: v.link ? { label: "View details", path: s(v.link, 300) } : undefined }),
  inspection_scheduled: (v) => ({ subject: `Inspection scheduled: ${s(v.property, 120)}`, heading: "An inspection is scheduled", lines: [`${s(v.property, 120)} is due for inspection on ${s(v.when, 40)}.`], cta: v.link ? { label: "View the inspection", path: s(v.link, 300) } : undefined }),
  review_request: (v) => ({ subject: `How was your experience with ${s(v.agent, 80)}?`, heading: "Share your experience", lines: [`You can review ${s(v.agent, 80)} about ${s(v.about, 120)}. The link works once.`], cta: { label: "Write a review", path: s(v.link, 300) } }),
  security_notice: (v) => ({ subject: s(v.title, 160) || "Security notice for your account", heading: s(v.title, 160) || "Security notice", lines: [s(v.body, 600), "If this was not you, change your password and contact support."].filter(Boolean), cta: v.link ? { label: "Review your account", path: s(v.link, 300) } : undefined }),
  password_reset: (v) => ({ subject: "Choose a new password", heading: "Reset your password", lines: ["Use the button below to choose a new password. The link works once and expires in 1 hour.", "If you did not ask for this, you can ignore this email. Your password stays the same."], cta: v.link ? { label: "Choose a new password", path: s(v.link, 300) } : undefined }),
  digest: (v) => {
    const items = Array.isArray(v.items) ? (v.items as V[]).slice(0, 25) : [];
    return { subject: `${items.length} update${items.length === 1 ? "" : "s"} for you`, heading: "Your updates", lines: items.map((i) => [s(i.title, 160), s(i.body, 160)].filter(Boolean).join(": ")), cta: { label: "Open all notifications", path: "/me/notifications" } };
  },
};

export function renderEmail(template: string, vars: V, layout: Layout): Rendered {
  const t = TEMPLATES[template] ?? TEMPLATES.generic;
  const b = t(vars);
  const cta = b.cta ? { label: b.cta.label, url: safeLink(layout.baseUrl, b.cta.path) } : null;
  const items = template === "digest" && Array.isArray(vars.items) ? (vars.items as V[]).slice(0, 25) : null;
  const foot = layout.unsubscribeUrl
    ? `You are getting this because of your notification settings. Change them: ${layout.settingsUrl} . Stop emails like this: ${layout.unsubscribeUrl}`
    : `This is a service message about your account, so it cannot be switched off. Your other email choices: ${layout.settingsUrl}`;
  const text = [`Hello ${layout.recipientName},`, "", b.heading, "", ...b.lines, ...(cta?.url ? ["", `${cta.label}: ${cta.url}`] : []), "", "--", layout.platform, foot].join("\n");
  const li = items
    ? `<ul>${items.map((i) => { const u = safeLink(layout.baseUrl, s(i.link, 300)); const label = esc([s(i.title, 160), s(i.body, 160)].filter(Boolean).join(": ")); return `<li>${u ? `<a href="${esc(u)}">${label}</a>` : label}</li>`; }).join("")}</ul>`
    : b.lines.map((l) => `<p>${esc(l)}</p>`).join("");
  const home = layout.baseUrl.replace(/\/+$/, "");
  // Brand header: the app icon (a PNG, which every mail program shows; SVG is blocked by many) and the wordmark.
  const brandBar = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="padding-right:10px"><img src="${esc(home)}/icons/icon-192.png" width="36" height="36" alt="" style="display:block;border-radius:9px"></td><td style="font:700 22px Arial,Helvetica,sans-serif;color:${BRAND.ink};letter-spacing:-.5px">${esc(layout.platform.toLowerCase())}</td></tr></table>`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;max-width:560px;margin:0 auto;padding:16px">${brandBar}<p>Hello ${esc(layout.recipientName)},</p><h2 style="margin:16px 0 8px">${esc(b.heading)}</h2>${li}${cta?.url ? `<p><a href="${esc(cta.url)}" style="display:inline-block;padding:12px 18px;background:${BRAND.amber};color:${BRAND.ink};font-weight:bold;text-decoration:none;border-radius:8px">${esc(cta.label)}</a></p>` : ""}<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#52606d">${esc(layout.platform)}<br>${layout.unsubscribeUrl ? `You are getting this because of your <a href="${esc(layout.settingsUrl)}">notification settings</a>. <a href="${esc(layout.unsubscribeUrl)}">Stop emails like this</a>.` : `This is a service message about your account, so it cannot be switched off. <a href="${esc(layout.settingsUrl)}">Your other email choices</a>.`}</p></body></html>`;
  return { subject: b.subject.replace(/[\r\n]+/g, " ").slice(0, 200), text, html };
}
