/**
 * Chats: files and voice notes (checked by their contents, private to the chat), reactions (one per person, from a fixed set)
 * and the typing indicator.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withUser } from "../../src/lib/db";
import { registerSeeker, saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { attachmentFor, blockUser, getConversation, messagesSince, reactToMessage, sendAttachment, setTyping, startConversation } from "../../src/lib/services/messaging";
import { asPerson } from "../../src/lib/services/collab";
import { newCompany, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const seeker = async (label = "chat") => (await registerSeeker({ name: `${label} Person ${uid()}`, email: `${label}-${uid()}@example.test`, password: PASSWORD })).userId;
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64"));
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(200).fill(1)]);

async function chat() {
  const co = await newCompany("chatagent");
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `Chat Homes ${uid()}`, tagline: "Homes", listed: true });
  await saveAgentProfile(co, { displayName: "Chat Agent", headline: "Lettings", bio: "", listed: true, acceptsMessages: true });
  const p = await seeker();
  const c = await startConversation(asPerson(p), { toUserId: co.userId, subject: "A flat", body: "Is it still available?" } as never);
  return { agent: asPerson(co.userId), person: asPerson(p), conversationId: c.id };
}

test("files and voice notes reach the people in the chat only, and only real photos, documents and recordings are accepted", async () => {
  const { agent, person, conversationId } = await chat();
  const photo = await sendAttachment(person, conversationId, { kind: "FILE", name: "front.png", type: "image/png", bytes: PNG, caption: "The front door" });
  assert.equal(photo.kind, "FILE");
  assert.equal(photo.body, "The front door");
  assert.equal(photo.attachment.mimeType, "image/png");
  const doc = await sendAttachment(agent, conversationId, { kind: "FILE", name: "../Tenancy.pdf", type: "application/octet-stream", bytes: PDF });
  assert.equal(doc.attachment.name, "Tenancy.pdf");
  assert.equal(doc.attachment.mimeType, "application/pdf");
  const voice = await sendAttachment(person, conversationId, { kind: "VOICE", name: "note.webm", type: "audio/webm", bytes: WEBM, durationMs: 4200 });
  assert.equal(voice.attachment.durationMs, 4200);

  await assert.rejects(sendAttachment(person, conversationId, { kind: "FILE", name: "page.html", type: "text/plain", bytes: new TextEncoder().encode("<html><script>x</script>") }), /Send photos/);
  await assert.rejects(sendAttachment(person, conversationId, { kind: "FILE", name: "fake.png", type: "image/png", bytes: new TextEncoder().encode("not a picture") }), /Send photos/);
  await assert.rejects(sendAttachment(person, conversationId, { kind: "VOICE", name: "v.webm", type: "audio/webm", bytes: WEBM, durationMs: 100 }), /too short/);

  // The other person sees them, with the file's details but not its bytes; the file itself downloads for members only.
  const view = await getConversation(agent, conversationId);
  const shown = view.messages.find((m) => m.id === photo.id)!;
  assert.equal(shown.attachment?.name, "front.png");
  assert.ok(!("bytes" in (shown.attachment as object)));
  assert.equal(Buffer.from((await attachmentFor(agent, photo.attachment.id))!.bytes).equals(Buffer.from(PNG)), true);
  const outsider = asPerson(await seeker("outsider"));
  assert.equal(await attachmentFor(outsider, photo.attachment.id), null);
  await assert.rejects(sendAttachment(outsider, conversationId, { kind: "FILE", name: "x.png", type: "image/png", bytes: PNG }), /not found/i);
  // The database refuses a file on someone else's message.
  await assert.rejects(withUser(person.userId, (tx) => tx.messageAttachment.create({ data: { messageId: doc.id, conversationId, uploaderId: person.userId, name: "x.png", mimeType: "image/png", sizeBytes: PNG.length, bytes: Buffer.from(PNG) } })));

  // Blocking stops files as it stops text.
  await blockUser(agent, person.userId);
  await assert.rejects(sendAttachment(person, conversationId, { kind: "FILE", name: "y.png", type: "image/png", bytes: PNG }), /cannot message/);
});

test("one reaction per person per message, from the offered set; typing shows for a few seconds", async () => {
  const { agent, person, conversationId } = await chat();
  const first = (await getConversation(person, conversationId)).messages[0];
  assert.equal((await reactToMessage(agent, first.id, "👍")).length, 1);
  await reactToMessage(person, first.id, "❤️");
  let r = await reactToMessage(agent, first.id, "😂");
  assert.deepEqual(r.map((x) => x.emoji).sort(), ["❤️", "😂"].sort(), "a new reaction replaces your old one");
  r = await reactToMessage(agent, first.id, "😂");
  assert.deepEqual(r.map((x) => x.emoji), ["❤️"], "the same reaction again takes it away");
  await assert.rejects(reactToMessage(agent, first.id, "🔥"), /Choose one of the reactions/);
  const outsider = asPerson(await seeker("nosy"));
  await assert.rejects(reactToMessage(outsider, first.id, "👍"), /not found/i);
  await assert.rejects(withUser(outsider.userId, (tx) => tx.messageReaction.create({ data: { messageId: first.id, conversationId, userId: outsider.userId, emoji: "👍" } })));

  await setTyping(agent, conversationId);
  const since = await messagesSince(person, conversationId, new Date(), new Date(0));
  assert.equal(since.typing.length, 1);
  assert.deepEqual(since.reactions.map((x) => x.emoji), ["❤️"]);
  assert.equal((await messagesSince(agent, conversationId, new Date())).typing.length, 0, "you do not see yourself typing");
});

test("a location can be shared as a pin, with a screened label, and is checked", async () => {
  const { sendLocation } = await import("../../src/lib/services/messaging");
  const { agent, person, conversationId } = await chat();
  const m = await sendLocation(person, conversationId, { lat: 6.4281234, lng: 3.4219876, label: "Gate 2", accuracyM: 12.4, source: "device" });
  assert.equal(m.kind, "LOCATION");
  assert.equal(m.body, "Gate 2");
  assert.deepEqual(m.details, { lat: 6.42812, lng: 3.42199, accuracyM: 12, source: "device" });
  await assert.rejects(sendLocation(person, conversationId, { lat: 123, lng: 3, source: "map" }), /could not be read/);
  await assert.rejects(sendLocation(person, conversationId, { lat: 0, lng: 0, source: "map" }), /could not be read/);
  const outsider = asPerson(await seeker("locnosy"));
  await assert.rejects(sendLocation(outsider, conversationId, { lat: 6.4, lng: 3.4, source: "map" }), /not found/i);
  assert.ok((await getConversation(agent, conversationId)).messages.some((x) => x.kind === "LOCATION"));
});
