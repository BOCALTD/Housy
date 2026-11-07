import { test } from "node:test";
import assert from "node:assert/strict";
import { areaLabel, boundaryAreaSqm, checkBoundary, circleBounds, directionsLinks, distanceLabel, mapLayers, nearbyCacheKey, nearbyCell, overpassFailed, overpassQuery, parseNear, parseOverpass, parseRoute, summariseNearby, travelEstimate } from "../../src/lib/location-rules";
import { distanceKm, inBounds } from "../../src/lib/geo-rules";

test("satellite is offered only with a provider that allows it", () => {
  assert.deepEqual(mapLayers({}).map((l) => l.id), ["streets"]);
  const mt = mapLayers({ NEXT_PUBLIC_MAP_TILES: "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abc123" });
  assert.deepEqual(mt.map((l) => l.id), ["streets", "satellite"]);
  assert.equal(mt[1].url, "https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=abc123");
  assert.equal(mt[1].tileSize, 512); assert.equal(mt[1].zoomOffset, -1);
  const own = mapLayers({ NEXT_PUBLIC_MAP_SATELLITE_TILES: "https://tiles.example.ng/sat/{z}/{x}/{y}.jpg" });
  assert.equal(own[1].url, "https://tiles.example.ng/sat/{z}/{x}/{y}.jpg"); assert.equal(own[1].tileSize, 256);
  assert.equal(mapLayers({ NEXT_PUBLIC_MAP_SATELLITE_TILES: "http://insecure/{z}/{x}/{y}" }).length, 1);
});

test("radius search: only the allowed radii, and the box always contains the circle", () => {
  assert.equal(parseNear("6.45,3.47", "7"), null);
  assert.equal(parseNear("abc", "5"), null);
  const n = parseNear("6.45,3.47", "5")!;
  const b = circleBounds(n.centre, n.km);
  for (let a = 0; a < 360; a += 15) {
    const r = (a * Math.PI) / 180;
    const p = { lat: 6.45 + (4.99 / 110.574) * Math.sin(r), lng: 3.47 + (4.99 / (111.32 * Math.cos((6.45 * Math.PI) / 180))) * Math.cos(r) };
    assert.ok(inBounds(p, b)); assert.ok(distanceKm(n.centre, p) < 5.05);
  }
  assert.equal(distanceLabel(0.43), "450 m"); assert.equal(distanceLabel(3.44), "3.4 km"); assert.equal(distanceLabel(27.6), "28 km");
});

test("nearby places and landmarks: one cached lookup per square kilometre, classified and summarised nearest first", () => {
  assert.equal(nearbyCell({ lat: 6.44781, lng: 3.47372 }), "6.45,3.47");
  assert.equal(nearbyCacheKey({ lat: 6.44781, lng: 3.47372 }), "6.45,3.47");
  const q = overpassQuery({ lat: 6.45, lng: 3.47 });
  assert.match(q, /^\[out:json\]\[timeout:60\];/);
  // One statement per kind and key, values as one pattern, in a square: everyday places reach 2 km past the cell slack (2.8 km
  // each way), landmarks 5 km and need a name.
  assert.match(q, /nw\["amenity"~"\^\(school\|kindergarten\|college\|university\)\$"\]\(6\.42485,3\.44469,6\.47515,3\.49531\);/);
  assert.match(q, /nw\["tourism"~"\^\(attraction\|museum[^"]*\)\$"\]\["name"\]\(6\.39790,3\.41757,6\.50210,3\.52243\);/);
  assert.doesNotMatch(q, /around:|nwr\[/);
  assert.equal((q.match(/out tags center qt/g) ?? []).length, 13, "each kind is printed on its own, so one kind cannot crowd out the others");
  assert.ok(q.length < 4000);
  const places = parseOverpass({ elements: [
    { type: "node", id: 1, lat: 6.451, lon: 3.471, tags: { amenity: "school", name: "Corona School" } },
    { type: "way", id: 2, center: { lat: 6.457, lon: 3.475 }, tags: { amenity: "school" } },
    { type: "node", id: 3, lat: 6.449, lon: 3.47, tags: { amenity: "pharmacy", name: "MedPlus" } },
    { type: "node", id: 4, lat: 6.6, lon: 3.6, tags: { amenity: "pharmacy", name: "Too far" } },
    { type: "node", id: 5, tags: { amenity: "bank" } },
    { type: "node", id: 6, lat: 6.45, lon: 3.47, tags: { shop: "shoes" } },
    // A mall is shopping and a landmark; it comes back once for each, and twice more as a point and an outline.
    { type: "way", id: 7, center: { lat: 6.4601, lon: 3.4801 }, tags: { shop: "mall", name: "Circle Mall" } },
    { type: "way", id: 7, center: { lat: 6.4601, lon: 3.4801 }, tags: { shop: "mall", name: "Circle Mall" } },
    { type: "node", id: 8, lat: 6.4602, lon: 3.4802, tags: { shop: "mall", name: "Circle Mall" } },
    // A landmark 4 km away counts; an unnamed attraction does not.
    { type: "node", id: 9, lat: 6.486, lon: 3.47, tags: { tourism: "attraction", name: "Lekki Conservation Centre" } },
    { type: "node", id: 10, lat: 6.452, lon: 3.47, tags: { tourism: "attraction" } },
  ] });
  assert.equal(places.filter((p) => p.name === "Circle Mall").length, 2, "one as shopping, one as a landmark");
  const s = summariseNearby({ lat: 6.45, lng: 3.47 }, places);
  assert.deepEqual(s.map((x) => [x.kind, x.count]), [["landmark", 2], ["school", 2], ["pharmacy", 1], ["shopping", 1]]);
  assert.deepEqual(s[0].nearest.map((n) => n.name), ["Circle Mall", "Lekki Conservation Centre"]);
  assert.equal(s[0].km, 5);
  assert.equal(s[1].nearest[0].name, "Corona School");
  assert.equal(s[1].nearest[1].name, "A school");
  assert.deepEqual(parseOverpass({ remark: "runtime error" }), []);
  // A server that ran out of time still answers 200 with a partial list: that is a failure, not "nothing nearby".
  assert.equal(overpassFailed({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 26 seconds." }), true);
  assert.equal(overpassFailed({ elements: [] }), false);
});

test("travel time is a range from quiet roads to rush hour; a routing service answer is read when there is one", () => {
  const t = travelEstimate({ lat: 6.4478, lng: 3.4737 }, { lat: 6.6018, lng: 3.3515 });
  assert.ok(t.roadKm > 25 && t.roadKm < 30);
  assert.ok(t.car.minMin >= 40 && t.car.minMin <= 50 && t.car.maxMin >= 100 && t.car.maxMin <= 120);
  assert.equal(t.walkMin, null);
  assert.ok(travelEstimate({ lat: 6.45, lng: 3.47 }, { lat: 6.455, lng: 3.47 }).walkMin! < 15);
  assert.deepEqual(parseRoute({ code: "Ok", routes: [{ distance: 23400, duration: 2710 }] }), { km: 23.4, minutes: 45 });
  assert.equal(parseRoute({ code: "NoRoute", routes: [] }), null);
});

test("directions open in the person's own maps app", () => {
  const d = directionsLinks({ lat: 6.4478, lng: 3.4737 }, { lat: 6.5, lng: 3.35 }, [{ lat: 6.45, lng: 3.4 }]);
  const g = new URL(d.google);
  assert.equal(g.searchParams.get("destination"), "6.447800,3.473700");
  assert.equal(g.searchParams.get("origin"), "6.500000,3.350000");
  assert.equal(g.searchParams.get("waypoints"), "6.450000,3.400000");
  assert.match(d.apple, /daddr=6\.447800,3\.473700&saddr=6\.500000,3\.350000/);
  assert.match(d.waze, /ll=6\.447800,3\.473700&navigate=yes/);
});

test("a site outline must be a sensible shape", () => {
  const sq: [number, number][] = [[6.45, 3.47], [6.45, 3.471], [6.451, 3.471], [6.451, 3.47]];
  const ok = checkBoundary(sq);
  assert.ok(ok.ok);
  assert.match(areaLabel(boundaryAreaSqm(sq)), /^about 1\.2 hectares$/);
  assert.equal((checkBoundary([[6.45, 3.47], [6.45, 3.471]]) as { error: string }).error, "An outline needs at least 3 corners");
  assert.match((checkBoundary([[6.45, 3.47], [6.451, 3.471], [6.45, 3.471], [6.451, 3.47]]) as { error: string }).error, /crosses itself/);
  assert.match((checkBoundary([[6.45, 3.47], [6.6, 3.47], [6.6, 3.6]]) as { error: string }).error, /10 km/);
  assert.equal(checkBoundary("nope").ok, false);
});
