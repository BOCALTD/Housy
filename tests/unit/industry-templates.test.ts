import { test } from "node:test";
import assert from "node:assert/strict";
import { INDUSTRY_KEYS, TEMPLATES, checkChoices, templateFor } from "../../src/lib/industry-templates";

test("every kind of business has a complete, well-formed template", () => {
  assert.deepEqual(TEMPLATES.map((t) => t.key), [...INDUSTRY_KEYS]);
  for (const t of TEMPLATES) {
    assert.ok(t.departments.length >= 3, t.key);
    for (const d of t.departments) assert.match(d.code, /^[A-Z0-9]{2,8}$/, `${t.key} ${d.code}`);
    assert.equal(new Set(t.departments.map((d) => d.code)).size, t.departments.length);
    assert.ok(t.checklists.length >= 2);
    for (const k of t.checklists) assert.ok(k.items.length >= 3 && k.items.every((i) => i.category && i.prompt), `${t.key} ${k.name}`);
    assert.equal(new Set(t.obligations.map((o) => o.id)).size, t.obligations.length);
    for (const o of t.obligations) assert.ok(o.months === null || (o.months >= 1 && o.months <= 120));
    for (const r of t.commission) assert.ok(Number(r.usual) > 0);
    assert.ok(t.firstSteps.every((f) => f.href.startsWith("/")));
    assert.ok(t.reminders.leadDays >= 1 && t.reminders.leadDays <= 365 && t.reminders.escalationDays >= 1 && t.reminders.escalationDays <= 90);
  }
  assert.equal(templateFor("NOPE"), null);
});

test("nothing is applied without the administrator's own dates and rates", () => {
  const t = templateFor("LETTING")!;
  assert.deepEqual(checkChoices(t, { obligations: { insurance: "2027-01-31" }, commission: { letting: "10" } }, "2026-11-01"), []);
  assert.deepEqual(checkChoices(t, { obligations: { insurance: "" }, commission: {} }, "2026-11-01"), ['Enter when "Building insurance renewal" is next due']);
  assert.deepEqual(checkChoices(t, { obligations: { insurance: "2026-10-01" }, commission: {} }, "2026-11-01"), ['"Building insurance renewal": choose a date from today on']);
  assert.deepEqual(checkChoices(t, { obligations: {}, commission: { letting: "" } }, "2026-11-01"), ['Enter the percentage for "Letting fee" (more than 0, at most 50)']);
  assert.deepEqual(checkChoices(t, { obligations: {}, commission: { letting: "80" } }, "2026-11-01"), ['Enter the percentage for "Letting fee" (more than 0, at most 50)']);
});
