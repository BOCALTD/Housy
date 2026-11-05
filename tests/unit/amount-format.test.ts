import { test } from "node:test";
import assert from "node:assert/strict";
import { groupDigits } from "../../src/components/AmountFormat";

test("amounts get thousands separators and nothing else changes", () => {
  assert.equal(groupDigits("25000000"), "25,000,000");
  assert.equal(groupDigits("25,000000"), "25,000,000");
  assert.equal(groupDigits("1500.5"), "1,500.5");
  assert.equal(groupDigits("999"), "999");
  assert.equal(groupDigits("₦2000"), "₦2,000");
  assert.equal(groupDigits(""), "");
  assert.equal(groupDigits("abc"), "abc");
  assert.equal(groupDigits("12.345"), "12.345"); // three decimals is not money: left alone
});
