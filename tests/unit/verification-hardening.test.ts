import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CASE_STATUSES, canMoveCase, type CaseStatus } from "../../src/lib/verification-case-rules";
import { VP_ROLES } from "../../src/lib/verification-network-rules";

test("the database's case guard allows each mover exactly the moves the rules give them", () => {
  const sql = readFileSync(new URL("../../prisma/migrations/20270103000000_verification_hardening/migration.sql", import.meta.url), "utf8");
  const inDb = [...sql.matchAll(/\('(platform|customer|provider)','([A-Z_]+)','([A-Z_]+)','([A-Z ]*)'\)/g)].map((m) => `${m[1]} ${m[2]}>${m[3]} ${m[4]}`).sort();
  const fromRules: string[] = [];
  for (const f of CASE_STATUSES) for (const t of CASE_STATUSES) {
    if (canMoveCase(f as CaseStatus, t as CaseStatus, { kind: "platform" })) fromRules.push(`platform ${f}>${t} `);
    if (canMoveCase(f as CaseStatus, t as CaseStatus, { kind: "customer" })) fromRules.push(`customer ${f}>${t} `);
    const roles = VP_ROLES.filter((r) => canMoveCase(f as CaseStatus, t as CaseStatus, { kind: "provider", role: r }));
    if (roles.length) fromRules.push(`provider ${f}>${t} ${roles.join(" ")}`);
  }
  assert.deepEqual(inDb, fromRules.sort());
  // Spot checks of what matters most.
  assert.ok(!inDb.some((r) => r.startsWith("customer REQUESTED>READY_FOR_ASSIGNMENT")), "a customer cannot skip payment");
  assert.ok(!inDb.some((r) => r.startsWith("provider") && /PLATFORM_REVIEW|APPROVED_FOR_RELEASE|DELIVERED/.test(r.split(" ")[1])), "a provider never approves or releases its own report");
});
