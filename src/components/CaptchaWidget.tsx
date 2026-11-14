"use client";

import { useEffect, useRef } from "react";

type Props = { provider: "recaptcha_v2" | "recaptcha_v3" | "turnstile"; siteKey: string; place: string };
type Grecaptcha = { ready(cb: () => void): void; render(el: HTMLElement, o: Record<string, unknown>): number; execute(key: string, o: { action: string }): Promise<string> };
type Turnstile = { render(el: HTMLElement, o: Record<string, unknown>): string; remove(id: string): void };
declare global { interface Window { grecaptcha?: Grecaptcha; turnstile?: Turnstile } }

const loading = new Map<string, Promise<void>>();
function load(src: string) {
  if (!loading.has(src)) loading.set(src, new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.defer = true; s.onload = () => ok(); s.onerror = () => { loading.delete(src); fail(new Error("load")); };
    document.head.appendChild(s);
  }));
  return loading.get(src)!;
}
const waitFor = <T,>(get: () => T | undefined) => new Promise<T>((ok) => { const t = setInterval(() => { const v = get(); if (v) { clearInterval(t); ok(v); } }, 50); });

/**
 * The person check inside a form. v2 and Turnstile show their box; v3 is invisible and fetches its token as the form is sent.
 * The provider's script adds the answer to the form as a hidden field, which the server checks.
 */
export function CaptchaWidget({ provider, siteKey, place }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const v3 = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false, turnstileId = "";
    const el = box.current;
    if (!el) return;
    if (provider === "turnstile") {
      load("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit").then(() => waitFor(() => window.turnstile)).then((t) => {
        if (!cancelled && !el.childElementCount) turnstileId = t.render(el, { sitekey: siteKey, action: place, size: "flexible" });
      }).catch(() => {});
      return () => { cancelled = true; if (turnstileId) window.turnstile?.remove(turnstileId); };
    }
    if (provider === "recaptcha_v2") {
      load("https://www.google.com/recaptcha/api.js?render=explicit").then(() => waitFor(() => window.grecaptcha?.render ? window.grecaptcha : undefined)).then((g) => {
        g.ready(() => { if (!cancelled && !el.childElementCount) g.render(el, { sitekey: siteKey }); });
      }).catch(() => {});
      return () => { cancelled = true; };
    }
    // v3: get a fresh token just before the form is sent.
    const form = el.closest("form");
    load(`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`).catch(() => {});
    const onSubmit = (e: SubmitEvent) => {
      const input = v3.current;
      if (!input || input.value) return;
      e.preventDefault();
      const submitter = e.submitter as HTMLElement | null;
      waitFor(() => window.grecaptcha?.execute ? window.grecaptcha : undefined).then((g) => g.ready(() => {
        g.execute(siteKey, { action: place }).then((token) => {
          input.value = token;
          form?.requestSubmit(submitter instanceof HTMLButtonElement ? submitter : undefined);
          setTimeout(() => { input.value = ""; }, 90_000);
        });
      }));
    };
    form?.addEventListener("submit", onSubmit);
    return () => { cancelled = true; form?.removeEventListener("submit", onSubmit); };
  }, [provider, siteKey, place]);
  if (provider === "recaptcha_v3") {
    return <div ref={box} className="captcha captcha-v3"><input ref={v3} type="hidden" name="g-recaptcha-response" /><p className="small muted">This form is protected by reCAPTCHA. Google&apos;s <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Privacy Policy</a> and <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Terms</a> apply.</p></div>;
  }
  return <div ref={box} className="captcha" aria-label="Check that you are a person" />;
}
