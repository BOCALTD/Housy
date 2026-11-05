import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWLEDGE, retrieve, STARTERS } from "../../src/lib/assistant-knowledge";

test("the assistant finds the right help passage", () => {
  assert.equal(retrieve("how do I book an inspection")[0].id, "inspect");
  assert.equal(retrieve("is this agent a scam, should I pay the fee")[0].id, "fraud");
  assert.equal(retrieve("how does flatmate matching work")[0].id, "flatmates");
  assert.equal(retrieve("I need a plumber after moving in")[0].id, "artisans");
  assert.equal(retrieve("xyzzy").length, 0);
  assert.ok(KNOWLEDGE.every((p) => p.links.every(([href]) => href.startsWith("/"))));
  assert.ok(STARTERS.public.length >= 3 && STARTERS.workspace.length >= 3);
});
