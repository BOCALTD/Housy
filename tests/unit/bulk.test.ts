import { test } from "node:test";
import assert from "node:assert/strict";
import { emailIn, pickRecipients, readBulkUnsub, renderBulkEmail, sendProblem, signBulkUnsub, SENDS_PER_DAY } from "../../src/lib/bulk-rules";

test("a tenant's contact field gives its email address, if it has one", () => {
  assert.equal(emailIn("0803 555 0101, Ada.Obi@Example.com"), "ada.obi@example.com");
  assert.equal(emailIn("0803 555 0101"), null);
  assert.equal(emailIn(""), null);
});

test("recipients: once per address, never anyone who opted out, and the rest counted", () => {
  const r = pickRecipients([{ email: "a@x.test" }, { email: "A@X.test" }, { email: null }, { email: "b@x.test" }, { email: "c@x.test" }], new Set(["b@x.test"]));
  assert.deepEqual(r.send.map((x) => x.email), ["a@x.test", "c@x.test"]);
  assert.equal(r.noEmail, 1);
  assert.equal(r.optedOut, 1);
});

test("sends are limited per day and by the plan's monthly recipients", () => {
  assert.equal(sendProblem({ recipients: 10, usedThisMonth: 0, monthlyLimit: 100, sendsToday: 0 }), null);
  assert.match(sendProblem({ recipients: 0, usedThisMonth: 0, monthlyLimit: 100, sendsToday: 0 })!, /Nobody to send to/);
  assert.match(sendProblem({ recipients: 1, usedThisMonth: 0, monthlyLimit: 100, sendsToday: SENDS_PER_DAY })!, /a day/);
  assert.match(sendProblem({ recipients: 50, usedThisMonth: 60, monthlyLimit: 100, sendsToday: 0 })!, /only 40 are left/);
  assert.match(sendProblem({ recipients: 1, usedThisMonth: 100, monthlyLimit: 100, sendsToday: 0 })!, /all been used/);
});

test("unsubscribe links are signed for one company and one address", () => {
  const t = signBulkUnsub("s3cret", "co-1", "Ada@Example.com");
  assert.deepEqual(readBulkUnsub("s3cret", t), { companyId: "co-1", email: "ada@example.com" });
  assert.equal(readBulkUnsub("other", t), null);
  const [body, sig] = t.split(".");
  const forged = Buffer.from("co-2|ada@example.com").toString("base64url");
  assert.equal(readBulkUnsub("s3cret", `${forged}.${sig}`), null);
  assert.equal(readBulkUnsub("s3cret", body), null);
  assert.equal(readBulkUnsub("s3cret", ""), null);
});

test("the email escapes what the company wrote and always carries who sent it, why, and how to stop it", () => {
  const m = renderBulkEmail({ company: "Acme <Homes>", subject: "Water off\nSaturday", body: "Hi <b>all</b>\n\nSecond line\nwith break", recipientName: "Ada", audience: "TENANTS", unsubscribeUrl: "https://h.test/unsubscribe/company?t=x", platform: "Housy", baseUrl: "https://h.test" });
  assert.equal(m.subject, "Acme <Homes>: Water off Saturday");
  assert.ok(!m.html.includes("<b>all</b>"));
  assert.ok(m.html.includes("&lt;b&gt;all&lt;/b&gt;"));
  assert.ok(m.html.includes("Second line<br>with break"));
  assert.ok(m.html.includes("Acme &lt;Homes&gt;"));
  assert.match(m.text, /^Hello Ada,/);
  assert.match(m.text, /rent a property managed by Acme <Homes>/);
  assert.match(m.text, /Stop messages from Acme <Homes>: https:\/\/h\.test\/unsubscribe\/company\?t=x/);
});
