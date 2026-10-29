import { test } from "node:test";
import assert from "node:assert/strict";
import { landingPath, networkLink, shareLink, shareText, shareablePath } from "../../src/lib/share-rules";

const AGENT = "/agents/0b7f6c0e-1a2b-4c3d-8e9f-0123456789ab";

test("only property, reel, agent and company pages can be the target of a shared link", () => {
  assert.equal(shareablePath("/properties/PROP-ABC23456"), "/properties/PROP-ABC23456");
  assert.equal(shareablePath(AGENT), AGENT);
  for (const bad of ["//evil.example/x", "https://evil.example", "/admin", "/properties/PROP-ABC?x=1", "/agents/../admin", null, 42]) {
    assert.equal(shareablePath(bad), null, String(bad));
  }
});

test("a signed-in sharer's link carries their invite code and returns to the page; a guest's link goes straight to it", () => {
  assert.equal(shareLink("https://site.test/", "/properties/PROP-ABC23456", "ABCDEFGH"), "https://site.test/r/ABCDEFGH?to=%2Fproperties%2FPROP-ABC23456");
  assert.equal(shareLink("https://site.test", "/properties/PROP-ABC23456", null), "https://site.test/properties/PROP-ABC23456?shared=1");
  assert.equal(landingPath(AGENT), `${AGENT}?shared=1`);
});

test("the shared words give the key facts and invite people to sign up, and stay short", () => {
  const t = shareText("property", { title: "3 bedroom flat in Lekki", price: "₦4,500,000 / year", place: "Lekki, Lagos", details: ["3 bedrooms", "", "For rent"], by: "Alpha Estates" }, "Housy");
  assert.match(t, /^🏠 3 bedroom flat in Lekki\n₦4,500,000 \/ year · Lekki, Lagos\n3 bedrooms · For rent\nListed by Alpha Estates\n/);
  assert.match(t, /Sign up free to see more\.$/);
  assert.ok(shareText("property", { title: "x".repeat(300) }, "Housy").split("\n")[0].length <= 93);
  assert.match(shareText("agent", { title: "Ada", by: "Agent at Alpha" }, "Housy"), /Sign up free to message them/);
});

test("each network gets the link (and the words where it accepts them), safely encoded", () => {
  const url = "https://site.test/properties/PROP-ABC23456?shared=1";
  const wa = networkLink("whatsapp", url, "Hello & welcome", "Subject");
  assert.ok(wa.startsWith("https://wa.me/?text=") && decodeURIComponent(wa.split("text=")[1]).endsWith(url));
  assert.equal(new URL(networkLink("facebook", url, "t", "s")).searchParams.get("u"), url);
  assert.equal(new URL(networkLink("x", url, "a\nb\nc", "s")).searchParams.get("text"), "a · b");
  assert.equal(new URL(networkLink("linkedin", url, "t", "s")).searchParams.get("url"), url);
  assert.match(networkLink("email", url, "t", "My subject"), /^mailto:\?subject=My%20subject&body=t%0A%0A/);
});
