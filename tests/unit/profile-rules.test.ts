import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProfileImage } from "../../src/lib/profile-rules";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
test("profile pictures: real JPG, PNG and WEBP only, within size", () => {
  assert.doesNotThrow(() => checkProfileImage("avatar", "image/jpeg", jpeg));
  assert.throws(() => checkProfileImage("avatar", "image/gif", jpeg), /JPG, PNG or WEBP/);
  assert.throws(() => checkProfileImage("avatar", "image/png", jpeg), /not the picture type/);
  assert.throws(() => checkProfileImage("avatar", "image/jpeg", new Uint8Array()), /empty/);
  const big = new Uint8Array(700 * 1024); big.set([0xff, 0xd8, 0xff]);
  assert.throws(() => checkProfileImage("avatar", "image/jpeg", big), /too large/);
  assert.doesNotThrow(() => checkProfileImage("cover", "image/jpeg", big));
  const riffNotWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  assert.throws(() => checkProfileImage("avatar", "image/webp", riffNotWebp), /not the picture type/);
});
