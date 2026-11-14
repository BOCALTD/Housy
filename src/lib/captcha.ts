/**
 * The person check (Google reCAPTCHA v2 or v3, or Cloudflare Turnstile), when the administrator has turned one on in
 * Admin → Settings for this place. With none turned on, nothing is asked and every check passes.
 */
import { platformConfig, type CaptchaPlace } from "./services/platform-config";

export type CaptchaPublic = { provider: "recaptcha_v2" | "recaptcha_v3" | "turnstile"; siteKey: string };

/** What the page needs to show the check here, or null when it is not asked here. */
export async function captchaFor(place: CaptchaPlace): Promise<CaptchaPublic | null> {
  const c = (await platformConfig()).captcha;
  if (c.provider === "none" || !c.siteKey || !c.secret || !c.places.includes(place)) return null;
  return { provider: c.provider, siteKey: c.siteKey };
}

const VERIFY = { turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify", recaptcha: "https://www.google.com/recaptcha/api/siteverify" };
/** reCAPTCHA v3 gives a score from 0 (a program) to 1 (a person). */
const V3_MIN_SCORE = 0.5;

/** Pure: is the provider's answer a pass? */
export function captchaPassed(provider: CaptchaPublic["provider"], answer: { success?: boolean; score?: number; action?: string }, place: string): boolean {
  if (answer.success !== true) return false;
  if (provider === "recaptcha_v3") return typeof answer.score === "number" && answer.score >= V3_MIN_SCORE && (!answer.action || answer.action === place);
  return true;
}

/**
 * Check the token the form sent. Throws a plain instruction when the check is asked here and did not pass. If the provider
 * cannot be reached the form is refused, so the check cannot be skipped by making it time out.
 */
export async function checkCaptcha(form: FormData, place: CaptchaPlace, ip: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const pub = await captchaFor(place);
  if (!pub) return;
  const secret = (await platformConfig()).captcha.secret;
  const token = String(form.get(pub.provider === "turnstile" ? "cf-turnstile-response" : "g-recaptcha-response") ?? "").trim();
  if (!token) throw new Error("Complete the check that you are a person, then try again.");
  let answer: { success?: boolean; score?: number; action?: string };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown" && ip !== "local") body.set("remoteip", ip);
    const res = await fetchImpl(pub.provider === "turnstile" ? VERIFY.turnstile : VERIFY.recaptcha, { method: "POST", body, signal: AbortSignal.timeout(6000) });
    answer = (await res.json()) as typeof answer;
  } catch {
    throw new Error("We could not check that you are a person just now. Wait a moment and try again.");
  }
  if (!captchaPassed(pub.provider, answer, place)) throw new Error("The check that you are a person did not pass. Try it again.");
}
