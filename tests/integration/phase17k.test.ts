/**
 * Phase 17k: flatmate matching and the chat rooms matched flatmates are taken into.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { blockUser, getConversation, sendMessage } from "../../src/lib/services/messaging";
import { asPerson } from "../../src/lib/services/collab";
import {
  acceptFlatmateRequest, addToFlatmateRoom, flatmateView, leaveFlatmateRoom, myFlatmateActivity, myMatches, myRooms, saveFlatmateProfile, sendFlatmateRequest,
} from "../../src/lib/services/flatmates";

after(() => prisma.$disconnect());

const ANSWERS = { smoking: "NON_SMOKER", smokeOk: "NO_SMOKE", schedule: "REGULAR", personality: "INTROVERT", cleanliness: "TIDY", guests: "SOMETIMES", noise: "QUIET", drinking: "SOCIAL", pets: "LIKE_PETS", workFromHome: "SOMETIMES", cooking: "SOMETIMES", inclusive: "FINE" };

async function person(label: string, city: string, o: Partial<{ intent: string; answers: Record<string, string>; gender: string; genderPref: string }> = {}) {
  const { userId } = await registerSeeker({ name: `${label} Tester`, email: `${label}-${randomUUID().slice(0, 8)}@example.test`, password: "integration-test-pw" });
  await saveFlatmateProfile(userId, {
    displayName: label, intent: o.intent ?? "NEED_ROOM", country: "NG", city, areas: "Yaba", budgetMin: "100000", budgetMax: "200000",
    moveInFrom: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10), stayMonths: "12", ageBand: "25-34", agePref: "ANY",
    gender: o.gender ?? "WOMAN", genderPref: o.genderPref ?? "ANY", showGender: false, answers: { ...ANSWERS, ...(o.answers ?? {}) }, must: [],
    occupation: "Nurse", about: "Quiet and tidy.", roomListingRef: "", adult: true,
  });
  return userId;
}

test("profiles are private, matches respect city and preferences, and score how people live", async () => {
  const city = `Fmcity${randomUUID().slice(0, 6)}`;
  const outsider = (await registerSeeker({ name: "No Profile", email: `np-${randomUUID().slice(0, 8)}@example.test`, password: "integration-test-pw" })).userId;
  await assert.rejects(saveFlatmateProfile(outsider, { displayName: "X", intent: "NEED_ROOM", country: "NG", city, budgetMin: "1", budgetMax: "2", moveInFrom: "2026-12-01", ageBand: "25-34", answers: ANSWERS, adult: false } as never), /adults/);
  const ada = await person("Ada", city, { intent: "HAVE_ROOM" });
  const bisi = await person("Bisi", city);
  const chidi = await person("Chidi", city, { answers: { smoking: "SMOKER", smokeOk: "ANY", personality: "EXTROVERT", schedule: "NIGHT_OWL" }, gender: "MAN" });
  const womenOnly = await person("Dami", city, { genderPref: "WOMEN" });
  const elsewhere = await person("Efe", `Other${city}`);
  await assert.rejects(saveFlatmateProfile(bisi, { displayName: "Bisi", intent: "NEED_ROOM", country: "NG", city, budgetMin: "1", budgetMax: "2", moveInFrom: "2026-12-01", ageBand: "25-34", answers: ANSWERS, about: "Call me on 08031234567", adult: true } as never), /phone numbers/);

  assert.equal(await withUser(outsider, (tx) => tx.flatmateProfile.count({ where: { userId: ada } })), 0, "someone without a profile sees nobody");
  const m = await myMatches(ada);
  const ids = m.rows.map((r) => r.profile.userId);
  assert.ok(ids.includes(bisi) && ids.includes(chidi) && ids.includes(womenOnly));
  assert.ok(!ids.includes(elsewhere), "another city is not shown");
  assert.equal(m.rows[0].profile.userId === bisi || m.rows[0].profile.userId === womenOnly, true, "the closest match comes first");
  const bisiRow = m.rows.find((r) => r.profile.userId === bisi)!;
  assert.equal(bisiRow.match.band.label, "Perfectly matched");
  const chidiRow = m.rows.find((r) => r.profile.userId === chidi)!;
  assert.ok(chidiRow.match.score < bisiRow.match.score && chidiRow.match.bad.includes("Smoking clash"));
  assert.ok(!JSON.stringify(m.rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).includes("inclusive"), "the inclusiveness answer is never shown to others");
  assert.equal((await myMatches(chidi)).rows.some((r) => r.profile.userId === womenOnly), false, "a women-only household is not shown to a man");
});

test("a request, an acceptance, a chat room, adding a third matched person, and leaving", async () => {
  const city = `Roomcity${randomUUID().slice(0, 6)}`;
  const ada = await person("Ada", city, { intent: "HAVE_ROOM" });
  const bisi = await person("Bisi", city);
  const cleo = await person("Cleo", city);
  const dayo = await person("Dayo", city);

  await assert.rejects(sendFlatmateRequest(bisi, ada, "Call me on 08031234567"), /phone numbers/);
  await sendFlatmateRequest(bisi, ada, "Hi, your room sounds great");
  await assert.rejects(sendFlatmateRequest(bisi, ada, ""), /waiting/);
  const incoming = (await myFlatmateActivity(ada)).incoming;
  assert.equal(incoming.length, 1);
  const { conversationId } = await acceptFlatmateRequest(ada, incoming[0].id);
  const conv = await getConversation(asPerson(bisi), conversationId);
  assert.equal(conv.others.length, 1);
  assert.match(conv.messages[conv.messages.length - 1].body, /matched as flatmates/);

  // Asking someone who already asked you is an instant match.
  await sendFlatmateRequest(cleo, ada, "");
  const second = await sendFlatmateRequest(ada, cleo, "");
  assert.equal(second.matched, true);

  const room = (await myRooms(ada)).find((r) => r.conversationId === conversationId)!;
  await assert.rejects(addToFlatmateRoom(bisi, room.id, cleo), /only people you have matched/, "Bisi is not matched with Cleo");
  await assert.rejects(withUser(bisi, (tx) => tx.conversationMember.create({ data: { conversationId, userId: dayo, name: "Dayo" } })), "the database refuses it too");
  await addToFlatmateRoom(ada, room.id, cleo);
  assert.equal((await myRooms(cleo)).find((r) => r.id === room.id)!.members.length, 3);
  await sendMessage(asPerson(cleo), conversationId, "Hello both!");

  // A view of the profile is gone once one side blocks the other.
  await blockUser(asPerson(dayo), ada);
  assert.equal(await flatmateView(ada, dayo), null);

  await leaveFlatmateRoom(cleo, room.id);
  await leaveFlatmateRoom(bisi, room.id);
  await assert.rejects(sendMessage(asPerson(ada), conversationId, "Anyone?"), /closed/);
  assert.equal((await myRooms(ada)).some((r) => r.id === room.id), false, "a closed room is no longer listed");
});
