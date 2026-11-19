import { createHmac, timingSafeEqual } from "node:crypto";
import { BRAND } from "./brand";

// Bulk messaging rules, kept free of the database so they can be tested on their own.

/** Recipients a company may send to in a calendar month when its plan sets no number. */
export const DEFAULT_MONTHLY_RECIPIENTS = 2000;
/** Sends a company may start in a day, whatever its plan. */
export const SENDS_PER_DAY = 5;
export const SUBJECT_MAX = 150;
export const BODY_MAX = 5000;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** The first email address in free text (a tenant's contact field holds a phone number, an email, or both). */
export function emailIn(text: string | null | undefined): string | null {
  const m = EMAIL.exec(text ?? "");
  return m ? normEmail(m[0]) : null;
}

export const normEmail = (e: string) => e.trim().toLowerCase();

/** Who this message goes to, given the candidates, the people who opted out, and the monthly room left. Duplicates go once. */
export function pickRecipients<T extends { email: string | null }>(candidates: T[], optedOut: Set<string>): { send: (T & { email: string })[]; noEmail: number; optedOut: number } {
  const seen = new Set<string>();
  const send: (T & { email: string })[] = [];
  let noEmail = 0, out = 0;
  for (const c of candidates) {
    if (!c.email) { noEmail++; continue; }
    const e = normEmail(c.email);
    if (seen.has(e)) continue;
    seen.add(e);
    if (optedOut.has(e)) { out++; continue; }
    send.push({ ...c, email: e });
  }
  return { send, noEmail, optedOut: out };
}

/** Why a send cannot start, or null. */
export function sendProblem(o: { recipients: number; usedThisMonth: number; monthlyLimit: number; sendsToday: number }): string | null {
  if (o.recipients === 0) return "Nobody to send to: no one in this group has an email address you may write to.";
  if (o.sendsToday >= SENDS_PER_DAY) return `You can send ${SENDS_PER_DAY} bulk messages a day. Try again tomorrow.`;
  const left = Math.max(0, o.monthlyLimit - o.usedThisMonth);
  if (o.recipients > left) return left === 0 ? `Your plan allows ${o.monthlyLimit.toLocaleString("en-NG")} bulk recipients a month and they have all been used. It resets on the 1st.` : `This would go to ${o.recipients.toLocaleString("en-NG")} people, but only ${left.toLocaleString("en-NG")} ${left === 1 ? "is" : "are"} left on your plan this month. Choose a smaller group, or wait until the 1st.`;
  return null;
}

// ---------- Unsubscribe links ----------

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(`bulk:${body}`).digest("base64url");

export function signBulkUnsub(secret: string, companyId: string, email: string): string {
  const body = Buffer.from(`${companyId}|${normEmail(email)}`).toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

export function readBulkUnsub(secret: string, token: string): { companyId: string; email: string } | null {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(secret, body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [companyId, email] = Buffer.from(body, "base64url").toString().split("|");
  return companyId && email && EMAIL.test(email) ? { companyId, email } : null;
}

// ---------- The email ----------

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (t: string, max: number) => t.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);

export const AUDIENCE_REASON = {
  CLIENTS: (company: string) => `You are getting this because you agreed to hear from ${company}.`,
  TENANTS: (company: string) => `You are getting this because you rent a property managed by ${company}.`,
} as const;

/** The company's message as plain text and simple HTML. Everything the company wrote is escaped; links stay plain text. */
export function renderBulkEmail(o: { company: string; subject: string; body: string; recipientName: string; audience: keyof typeof AUDIENCE_REASON; unsubscribeUrl: string; platform: string; baseUrl: string }) {
  const subject = oneLine(o.subject, SUBJECT_MAX);
  const company = oneLine(o.company, 120);
  const paras = o.body.replace(/\r\n?/g, "\n").slice(0, BODY_MAX).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const hello = o.recipientName ? `Hello ${oneLine(o.recipientName, 80)},` : "Hello,";
  const reason = AUDIENCE_REASON[o.audience](company);
  const text = [hello, "", ...paras.flatMap((p) => [p, ""]), "--", `${company}, sent with ${o.platform}`, reason, `Stop messages from ${company}: ${o.unsubscribeUrl}`].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;max-width:560px;margin:0 auto;padding:16px">`
    + `<p style="margin:0 0 18px;font-weight:bold;font-size:18px">${esc(company)}</p><p>${esc(hello)}</p>`
    + paras.map((p) => `<p style="line-height:1.5">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")
    + `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#52606d">${esc(company)}, sent with <a href="${esc(o.baseUrl)}" style="color:${BRAND.ink}">${esc(o.platform)}</a>.<br>${esc(reason)} <a href="${esc(o.unsubscribeUrl)}">Stop messages from ${esc(company)}</a>.</p></body></html>`;
  return { subject: `${company}: ${subject}`.slice(0, 200), text, html };
}
