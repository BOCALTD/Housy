import { test } from "node:test";
import assert from "node:assert/strict";
import { captchaPassed } from "../../src/lib/captcha";
import { ipFromHeaders } from "../../src/lib/request-ip";

test("the person check passes only on the provider's success, and reCAPTCHA v3 also needs a person-like score for this form", () => {
  assert.equal(captchaPassed("turnstile", { success: true }, "login"), true);
  assert.equal(captchaPassed("turnstile", { success: false }, "login"), false);
  assert.equal(captchaPassed("recaptcha_v2", {}, "login"), false);
  assert.equal(captchaPassed("recaptcha_v3", { success: true, score: 0.9, action: "login" }, "login"), true);
  assert.equal(captchaPassed("recaptcha_v3", { success: true, score: 0.2, action: "login" }, "login"), false, "a low score is a program");
  assert.equal(captchaPassed("recaptcha_v3", { success: true, score: 0.9, action: "signup" }, "login"), false, "a token made for another form");
  assert.equal(captchaPassed("recaptcha_v3", { success: true }, "login"), false);
});

test("Cloudflare's visitor address is trusted only when the setting is on", () => {
  const h = new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
  assert.equal(ipFromHeaders(h, true), "203.0.113.9");
  assert.equal(ipFromHeaders(h, false), "198.51.100.7", "anyone can send the Cloudflare header to a server not behind Cloudflare");
  assert.equal(ipFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.7" }), true), "198.51.100.7");
  assert.equal(ipFromHeaders(new Headers(), false), "unknown");
});
