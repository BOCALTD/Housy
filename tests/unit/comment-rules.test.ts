import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThreads, threadRoot, withMention } from "../../src/lib/comment-rules";

const at = (m: number) => new Date(Date.UTC(2026, 10, 7, 10, m));
const rows = [
  { id: "a", parentId: null, authorName: "Ada", authorId: "u1", body: "Is it serviced?", createdAt: at(1) },
  { id: "b", parentId: null, authorName: "Bola", authorId: "u2", body: "Lovely view", createdAt: at(5) },
  { id: "a2", parentId: "a", authorName: "Agent", authorId: "u3", body: "@Ada yes", createdAt: at(9) },
  { id: "a1", parentId: "a", authorName: "Bola", authorId: "u2", body: "Same question", createdAt: at(3) },
  { id: "x", parentId: "gone", authorName: "Z", authorId: "u9", body: "orphan", createdAt: at(2) },
];

test("threads: newest comment first, replies oldest first under their comment, likes and mine", () => {
  const t = buildThreads(rows, new Map([["a", 3], ["a2", 1]]), new Set(["a2"]), "u2");
  assert.deepEqual(t.map((c) => c.id), ["b", "a"]);
  assert.deepEqual(t[1].replies.map((r) => r.id), ["a1", "a2"]);
  assert.equal(t[1].likes, 3); assert.equal(t[1].liked, false);
  assert.equal(t[1].replies[1].liked, true); assert.equal(t[1].replies[1].likes, 1);
  assert.equal(t[0].mine, true); assert.equal(t[1].mine, false);
  assert.equal(buildThreads(rows, new Map(), new Set(), null, "oldest")[0].id, "a");
  assert.ok(!t.some((c) => c.id === "x" || c.replies.some((r) => r.id === "x")), "a reply whose comment is gone is not shown");
});

test("a reply to a reply joins the same thread and names the person", () => {
  assert.equal(threadRoot({ id: "a", parentId: null }), "a");
  assert.equal(threadRoot({ id: "a2", parentId: "a" }), "a");
  assert.equal(withMention("Thanks!", { authorName: "Tunde Bello", isReply: true }), "@Tunde Thanks!");
  assert.equal(withMention("@tunde thanks", { authorName: "Tunde Bello", isReply: true }), "@tunde thanks");
  assert.equal(withMention("Thanks!", { authorName: "Tunde", isReply: false }), "Thanks!");
});
