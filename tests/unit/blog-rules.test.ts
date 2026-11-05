import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTags, parseBody, plainText, readingMinutes, safeHref, slugify } from "../../src/lib/blog-rules";
import { STARTER_POSTS } from "../../src/lib/blog-starters";

test("slugs are clean web addresses", () => {
  assert.equal(slugify("How to inspect a property before you pay a kobo"), "how-to-inspect-a-property-before-you-pay-a-kobo");
  assert.equal(slugify("  Fees & Charges: 2026!  "), "fees-and-charges-2026");
  assert.equal(slugify("Café déjà vu"), "cafe-deja-vu");
  assert.equal(slugify("!!!"), "post");
  assert.ok(slugify("a ".repeat(100)).length <= 80);
  assert.ok(!slugify("a ".repeat(100)).endsWith("-"));
});

test("reading time and tags", () => {
  assert.equal(readingMinutes("word"), 1);
  assert.equal(readingMinutes("word ".repeat(1100)), 5);
  assert.deepEqual(cleanTags("Renting, renting , Lagos!, x, a very long tag that goes on and on and on"), ["renting", "lagos", "a very long tag that goes on a"]);
});

test("only safe links survive", () => {
  assert.deepEqual(safeHref("/market"), { href: "/market", external: false });
  assert.deepEqual(safeHref("https://example.com/a"), { href: "https://example.com/a", external: true });
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("http://plain.example"), null);
});

test("the body becomes headings, lists, quotes and paragraphs, never markup", () => {
  const b = parseBody("Intro **bold** and [a link](/safety).\n\n## Before you go\n- one\n- two\n\n1. first\n2. second\n\n> careful\n\n## Before you go\n<script>x</script> [bad](javascript:x)");
  assert.deepEqual(b.map((x) => x.t), ["p", "h2", "ul", "ol", "quote", "h2", "p"]);
  assert.equal((b[1] as { id: string }).id, "before-you-go");
  assert.equal((b[5] as { id: string }).id, "before-you-go-2");
  const last = b[6] as { parts: { t: string; v: string }[] };
  assert.equal(last.parts.some((p) => p.t === "a"), false, "unsafe link is plain text");
  assert.ok(last.parts.map((p) => p.v).join("").includes("<script>"), "kept as text, rendered escaped");
  assert.equal(plainText("## Hi\n- **a** [b](/c)"), "Hi a b");
});

test("starter guides meet the publishing rules", () => {
  for (const s of STARTER_POSTS) {
    assert.ok(s.title.length >= 8 && s.title.length <= 140, s.title);
    assert.ok(s.excerpt.length >= 40 && s.excerpt.length <= 300, s.title);
    assert.ok(s.body.length >= 200, s.title);
    for (const b of parseBody(s.body)) if ("parts" in b) for (const p of b.parts) if (p.t === "a") assert.ok(p.href.startsWith("/"), p.href);
  }
});
