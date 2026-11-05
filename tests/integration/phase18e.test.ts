/**
 * Phase 18e: the blog. Drafts are private to the platform administrator; publishing needs a cover and its description;
 * published posts, their covers and the sitemap list are public; unpublishing hides them again.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPublic } from "../../src/lib/db";
import { addStarterPosts, adminPosts, deletePost, getPost, listPosts, postCover, publishedSlugs, savePost, unpublishPost } from "../../src/lib/services/blog";
import { newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const PNG = new Uint8Array(Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"));
const body = "This is a long enough article body for the test. ".repeat(8) + "\n\n## A heading\n- a point\n- another";

test("write, publish, read and unpublish a post", async () => {
  const admin = await newPlatformAdmin();
  const stamp = Date.now().toString(36);
  const title = `Renting in Lagos ${stamp}`;
  const input = { title, excerpt: "A useful description of the article that is long enough to show on Google.", body, category: "guides", tags: "Renting, Lagos" };
  await assert.rejects(savePost(admin.id, "Admin", null, { ...input, publish: true }), /cover picture/);
  await assert.rejects(savePost(admin.id, "Admin", null, { ...input, category: "nonsense" }), /category/);
  await assert.rejects(savePost(admin.id, "Admin", null, input, { type: "image/gif", bytes: PNG }), /JPEG, PNG or WebP/);
  await assert.rejects(savePost(admin.id, "Admin", null, input, { type: "image/png", bytes: new Uint8Array(Buffer.from("<svg onload=alert(1)>")) }), /not the picture type/);
  const draft = await savePost(admin.id, "Admin", null, input);
  assert.equal(draft.status, "DRAFT");
  assert.deepEqual(draft.tags, ["renting", "lagos"]);
  assert.equal(await getPost(draft.slug), null, "drafts are not public");
  await assert.rejects(savePost(admin.id, "Admin", null, input), /already uses that web address/);

  await assert.rejects(savePost(admin.id, "Admin", draft.id, { ...input, publish: true }, { type: "image/png", bytes: PNG }), /Describe the cover/);
  const live = await savePost(admin.id, "Admin", draft.id, { ...input, coverAlt: "A street in Lagos", publish: true, featured: true }, { type: "image/png", bytes: PNG });
  assert.equal(live.status, "PUBLISHED");
  assert.ok(live.publishedAt);
  const r = await getPost(live.slug);
  assert.equal(r?.post.title, title);
  assert.ok(await postCover(live.slug));
  assert.ok((await publishedSlugs()).some((p) => p.slug === live.slug));
  assert.ok((await listPosts({ q: stamp })).total >= 1);
  assert.ok((await listPosts({ tag: "lagos" })).rows.length + ((await listPosts({ tag: "lagos" })).featured ? 1 : 0) >= 1);

  // Nobody but the platform administrator can write, even through a public connection.
  await assert.rejects(withPublic((tx) => tx.blogPost.create({ data: { slug: `x-${stamp}`, title: "x", excerpt: "x", body: "x", authorId: "x", authorName: "x", status: "PUBLISHED" } })));

  await unpublishPost(admin.id, live.id);
  assert.equal(await getPost(live.slug), null);
  assert.equal(await postCover(live.slug), null);
  await deletePost(admin.id, live.id);
});

test("starter guides are added once, as drafts", async () => {
  const admin = await newPlatformAdmin();
  await addStarterPosts(admin.id, "Housy team");
  const again = await addStarterPosts(admin.id, "Housy team");
  assert.equal(again, 0);
  const mine = await adminPosts(admin.id);
  assert.ok(mine.filter((p) => p.status === "DRAFT").length >= 4);
});
