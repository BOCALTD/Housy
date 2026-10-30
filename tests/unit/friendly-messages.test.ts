import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyMessage } from "../../src/lib/friendly-messages";

test("form checks without their own message read as plain English", () => {
  assert.equal(friendlyMessage({ code: "invalid_type", expected: "string", input: undefined }), "This is required");
  assert.equal(friendlyMessage({ code: "invalid_type", expected: "number", input: "abc" }), "Enter a number");
  assert.equal(friendlyMessage({ code: "too_big", origin: "string", maximum: 2000 }), "Use at most 2,000 characters");
  assert.equal(friendlyMessage({ code: "too_small", origin: "string", minimum: 1 }), "This is required");
  assert.equal(friendlyMessage({ code: "too_small", origin: "number", minimum: 0 }), "Enter 0 or more");
  assert.equal(friendlyMessage({ code: "invalid_format", format: "email" }), "Enter a valid email address");
  assert.equal(friendlyMessage({ code: "invalid_value" }), "Choose one of the options");
  assert.equal(friendlyMessage({ code: "custom" }), undefined, "a check's own message is kept");
});
