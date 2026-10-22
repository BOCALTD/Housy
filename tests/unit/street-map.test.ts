import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterCell, inBounds, parseBounds, shortMoney, validPosition } from "../../src/lib/geo-rules";
import { COUNTRY_VIEWS, WORLD_VIEW, countryView, visitorCountry } from "../../src/lib/countries";

test("the map opens on the visitor's own country", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
  assert.deepEqual(countryView(visitorCountry(h({ "cf-ipcountry": "GB" }))), COUNTRY_VIEWS.GB);
  assert.deepEqual(countryView(visitorCountry(h({ "x-vercel-ip-country": "CA" }))), COUNTRY_VIEWS.CA);
  assert.deepEqual(countryView(visitorCountry(h({ "accept-language": "en-GH,en;q=0.9" }))), COUNTRY_VIEWS.GH);
  assert.deepEqual(countryView(visitorCountry(h({}))), COUNTRY_VIEWS.NG);
  assert.deepEqual(countryView("FR"), WORLD_VIEW, "a country without a set view opens on the world");
  for (const [code, v] of Object.entries(COUNTRY_VIEWS)) assert.ok(validPosition(v.lat, v.lng) && v.zoom >= 3 && v.zoom <= 9, code);
});

test("positions anywhere in the world are accepted; nonsense is not", () => {
  assert.ok(validPosition(51.5072, -0.1276));
  assert.ok(validPosition(43.65, -79.38));
  assert.ok(validPosition(5.6037, -0.187));
  assert.ok(!validPosition(0, 0));
  assert.ok(!validPosition(91, 0));
  assert.ok(!validPosition(10, 200));
});

test("map bounds are read safely, and grouping gets finer as you zoom in", () => {
  assert.deepEqual(parseBounds("6.3,3.2,6.7,3.7"), { s: 6.3, w: 3.2, n: 6.7, e: 3.7 });
  assert.deepEqual(parseBounds("-100,-200,100,200"), { s: -85, w: -180, n: 85, e: 180 });
  assert.equal(parseBounds("6.7,3.2,6.3,3.7"), null);
  assert.equal(parseBounds("a,b,c,d"), null);
  assert.equal(parseBounds(null), null);
  assert.ok(inBounds({ lat: 6.5, lng: 3.4 }, { s: 6.3, w: 3.2, n: 6.7, e: 3.7 }));
  assert.ok(!inBounds({ lat: 51.5, lng: -0.1 }, { s: 6.3, w: 3.2, n: 6.7, e: 3.7 }));
  assert.ok(clusterCell(6) > clusterCell(12));
  assert.equal(clusterCell(0), 90);
});

test("map pins show short prices", () => {
  assert.equal(shortMoney(250_000_000n), "2.5m");
  assert.equal(shortMoney(18_500_000_000n), "185m");
  assert.equal(shortMoney(150_000_000_000n), "1.5bn");
  assert.equal(shortMoney(4_500_000n), "45k");
  assert.equal(shortMoney(90_000n), "900");
});
