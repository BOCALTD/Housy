import { envNow } from "./runtime-env";

// Email delivery. A driver sends one message and says plainly whether it worked and whether trying again could help.

export interface Outgoing { to: string; subject: string; text: string; html: string; headers?: Record<string, string>; idempotencyKey?: string; replyTo?: string }
export type SendResult = { ok: true; id: string } | { ok: false; permanent: boolean; error: string };
export interface EmailDriver { name: string; send(m: Outgoing): Promise<SendResult> }

/** Resend over HTTPS. A 4xx answer (other than "too many requests" or "timeout") means the message itself is wrong, so retrying would not help. */
export function resendDriver(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): EmailDriver {
  return {
    name: "resend",
    async send(m) {
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey } : {}) },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html, headers: m.headers, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
          signal: AbortSignal.timeout(15000),
        });
        const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
        if (res.ok && body.id) return { ok: true, id: body.id };
        const permanent = res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408;
        return { ok: false, permanent, error: `${res.status} ${body.message ?? "provider refused the message"}`.slice(0, 300) };
      } catch (e) {
        return { ok: false, permanent: false, error: e instanceof Error ? e.message.slice(0, 300) : "network error" };
      }
    },
  };
}

/**
 * An SMTP server (the email host's own: Zoho, Google Workspace, Microsoft 365, cPanel). Port 465 is secure from the start; other
 * ports must upgrade to a secure connection (STARTTLS), and the server's certificate is always checked.
 */
export function smtpDriver(c: { host: string; port: number; user: string; password: string; from: string; replyTo?: string }): EmailDriver {
  let transport: import("nodemailer").Transporter | null = null;
  const get = async () => {
    if (transport) return transport;
    const nodemailer = await import("nodemailer");
    transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.port === 465, requireTLS: c.port !== 465, auth: { user: c.user, pass: c.password },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    return transport;
  };
  return {
    name: "smtp",
    async send(m) {
      try {
        const t = await get();
        const r = await t.sendMail({ from: c.from, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers, replyTo: m.replyTo || c.replyTo || undefined, messageId: m.idempotencyKey ? `<${m.idempotencyKey.replace(/[^A-Za-z0-9._-]/g, "")}@housy.mail>` : undefined });
        return { ok: true, id: String(r.messageId ?? "").slice(0, 200) || "smtp" };
      } catch (e) {
        const err = e as { responseCode?: number; code?: string; message?: string };
        // 5xx from the server means the message or the account is refused; anything else (connection, 4xx) may pass later.
        const permanent = typeof err.responseCode === "number" && err.responseCode >= 500 && err.code !== "EAUTH";
        return { ok: false, permanent, error: `${err.responseCode ?? err.code ?? ""} ${err.message ?? "SMTP error"}`.trim().slice(0, 300) };
      }
    },
  };
}

/** The configured driver, or null when no provider has been connected. Nothing is ever pretended to be sent. */
export function configuredDriver(env: Record<string, string | undefined> = envNow()): EmailDriver | null {
  const from = env.EMAIL_FROM?.trim();
  if (!from) return null;
  const provider = env.EMAIL_PROVIDER?.trim() || (env.RESEND_API_KEY ? "resend" : env.SMTP_HOST ? "smtp" : "");
  if (provider === "resend" && env.RESEND_API_KEY) return resendDriver(env.RESEND_API_KEY, from);
  if (provider === "smtp" && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
    return smtpDriver({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 465, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from, replyTo: env.EMAIL_REPLY_TO });
  }
  return null;
}
