import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, parseInbound, tokenFrom } from "../../src/lib/inbound-email-rules";

test("the company token comes only from addresses on the inbound domain", () => {
  assert.equal(tokenFrom("in+abc123def456@in.housy.test", "in.housy.test"), "abc123def456");
  assert.equal(tokenFrom("in+abc123def456@elsewhere.test", "in.housy.test"), null);
  assert.equal(tokenFrom("someone@in.housy.test", "in.housy.test"), null);
});

test("an email in the provider's format becomes sender, recipients, subject, text and attachments", () => {
  const m = parseInbound({
    FromFull: { Email: "Ada@Example.com", Name: "Ada Obi" }, To: "Housy Lettings <in+abc123def456@in.housy.test>", Cc: "boss@example.com",
    Subject: "Rent for\\r\\nJune", HtmlBody: "<p>Hello<br>team</p><script>x()</script>", MessageID: "<m1@example.com>",
    Headers: [{ Name: "Auto-Submitted", Value: "no" }],
    Attachments: [{ Name: "receipt.pdf", ContentType: "application/pdf", Content: Buffer.from("%PDF-1.4 test").toString("base64") }],
  });
  assert.equal(m.fromEmail, "ada@example.com");
  assert.equal(m.fromName, "Ada Obi");
  assert.deepEqual(m.recipients, ["in+abc123def456@in.housy.test", "boss@example.com"]);
  assert.equal(m.text, "Hello\nteam");
  assert.equal(m.autoReply, false);
  assert.equal(m.attachments[0].type, "application/pdf");
  assert.equal(parseInbound({ From: "x@y.test", Subject: "Out of office: back Monday" }).autoReply, true);
  assert.equal(htmlToText("<style>p{}</style><div>A &amp; B</div>"), "A & B");
});
