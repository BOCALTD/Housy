// Email delivery. A driver sends one message and says plainly whether it worked and whether trying again could help.

export interface Outgoing { to: string; subject: string; text: string; html: string; headers?: Record<string, string>; idempotencyKey?: string }
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
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html, headers: m.headers }),
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

/** The configured driver, or null when no provider has been connected. Nothing is ever pretended to be sent. */
export function configuredDriver(env: NodeJS.ProcessEnv = process.env): EmailDriver | null {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) return resendDriver(env.RESEND_API_KEY, env.EMAIL_FROM);
  return null;
}
