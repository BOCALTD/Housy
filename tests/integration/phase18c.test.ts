/**
 * Phase 18c: the assistant as a conversation. Without an AI service it still answers from the built-in rules: a greeting, Housy
 * help, a property search, and (for a company member) a report from the company's records. Follow-ups use the earlier question.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { assistantReply } from "../../src/lib/services/assistant-chat";
import { newCompany } from "./helpers";

after(() => prisma.$disconnect());
const noAi = { ...process.env };
delete process.env.ANTHROPIC_API_KEY;
after(() => { process.env = noAi; });

test("the assistant greets, explains and searches without an AI service", async () => {
  const who = { visitorKey: `t-${Date.now()}`, name: "Ada Obi" };
  const hi = await assistantReply(who, [{ role: "user", content: "hello" }]);
  assert.match(hi.text, /Hello Ada/);
  assert.equal(hi.source, "RULES");
  const help = await assistantReply(who, [{ role: "user", content: "How do I book an inspection safely?" }]);
  assert.match(help.text, /never pay before you inspect/i);
  assert.ok(help.links.some(([href]) => href === "/safety"));
  const search = await assistantReply(who, [{ role: "user", content: "3 bedroom flat to rent in Lekki" }]);
  assert.ok(search.links.some(([href]) => href === "/browse"), "a property question searches");
  assert.ok(Array.isArray(search.cards));
  const follow = await assistantReply(who, [{ role: "user", content: "3 bedroom flat to rent in Lekki" }, { role: "assistant", content: search.text }, { role: "user", content: "cheaper ones?" }]);
  assert.ok(follow.links.some(([href]) => href === "/browse"), "a short follow-up keeps the topic");
  await assert.rejects(assistantReply(who, []), /Ask me something/);
});

test("a company member gets answers from their own records", async () => {
  const co = await newCompany("assistant");
  const a = await assistantReply({ visitorKey: "x", userId: co.userId, companyId: co.companyId, name: "Boss", member: co }, [{ role: "user", content: "How much rent is overdue?" }]);
  assert.ok(a.table, "a report table comes back");
  assert.ok(a.text.length > 10);
});
