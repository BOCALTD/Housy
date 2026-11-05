import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTrades, tradeLabel, MOVING_IN, TRADE_KEYS } from "../../src/lib/artisan-rules";

test("trades: only known ones, no repeats, at most six", () => {
  assert.deepEqual(cleanTrades(["plumber", "plumber", "astronaut", " painter "]), ["plumber", "painter"]);
  assert.deepEqual(cleanTrades("electrician,mason"), ["electrician", "mason"]);
  assert.equal(cleanTrades(TRADE_KEYS).length, 6);
  assert.deepEqual(cleanTrades(undefined), []);
  assert.equal(tradeLabel("ac"), "AC and fridge technician");
  assert.equal(tradeLabel("unknown"), "unknown");
  assert.ok(MOVING_IN.every((t) => TRADE_KEYS.includes(t)));
});
