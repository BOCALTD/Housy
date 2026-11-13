import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CASE_STATUSES, FINAL_CASE_STATUSES, canMoveCase, canonicalReport, caseRef, isCaseRef, rankProviders, reportGaps, type Candidate, type ReportContent } from "../../src/lib/verification-case-rules";

const P = { kind: "platform" } as const, C = { kind: "customer" } as const;
const prov = (role: "OWNER" | "ADMIN" | "MANAGER" | "INVESTIGATOR" | "REVIEWER" | "FINANCE") => ({ kind: "provider", role }) as const;

test("a case moves only along allowed steps, by the right people, and no mandatory review can be skipped", () => {
  assert.equal(caseRef(2026, 3), "HVR-2026-000003");
  assert.ok(isCaseRef("HVR-2026-000003") && !isCaseRef("HVR-1"));
  assert.ok(canMoveCase("READY_FOR_ASSIGNMENT", "ASSIGNED", P));
  assert.ok(!canMoveCase("READY_FOR_ASSIGNMENT", "ASSIGNED", prov("OWNER")), "a provider cannot assign a case to itself");
  assert.ok(canMoveCase("ASSIGNED", "ACCEPTED", prov("MANAGER")));
  assert.ok(!canMoveCase("ASSIGNED", "ACCEPTED", prov("INVESTIGATOR")));
  assert.ok(canMoveCase("REPORT_DRAFT", "INTERNAL_REVIEW", prov("INVESTIGATOR")));
  assert.ok(!canMoveCase("REPORT_DRAFT", "SUBMITTED_TO_HOUSY", prov("OWNER")), "the internal review cannot be skipped");
  assert.ok(canMoveCase("INTERNAL_REVIEW", "SUBMITTED_TO_HOUSY", prov("REVIEWER")));
  assert.ok(!canMoveCase("INTERNAL_REVIEW", "SUBMITTED_TO_HOUSY", prov("INVESTIGATOR")), "an investigator cannot approve their own report");
  assert.ok(!canMoveCase("SUBMITTED_TO_HOUSY", "DELIVERED", P), "Housy's quality review cannot be skipped");
  assert.ok(!canMoveCase("PLATFORM_REVIEW", "APPROVED_FOR_RELEASE", prov("OWNER")), "only Housy approves release");
  assert.ok(canMoveCase("DELIVERED", "DISPUTED", C) && !canMoveCase("DELIVERED", "DISPUTED", P));
  assert.ok(!canMoveCase("ACCEPTED", "CANCELLED", C), "once a provider has accepted, only Housy can cancel");
  for (const f of FINAL_CASE_STATUSES) for (const to of CASE_STATUSES) for (const by of [P, C, prov("OWNER")]) assert.ok(!canMoveCase(f, to, by), `${f} is final`);
});

const cand = (o: Partial<Candidate>): Candidate => ({ providerId: o.name ?? "x", name: "x", vetted: true, active: true, allowedServices: ["TITLE", "SITE_INSPECTION"], offeredServices: ["TITLE", "SITE_INSPECTION"], allowedStates: ["Lagos"], coveredStates: ["Lagos"], conflict: false, openCases: 2, monthlyCapacity: 20, completed: 10, onTime: 9, declined: 1, offered: 12, priceKobo: 15_000_000n, turnaroundDays: 7, ...o });

test("only qualified, covering, available providers without a conflict are eligible, and the ranking says why", () => {
  const r = rankProviders({ services: ["TITLE", "SITE_INSPECTION"], state: "Lagos" }, [
    cand({ name: "Steady" }),
    cand({ name: "Late", onTime: 3 }),
    cand({ name: "Unvetted", vetted: false }),
    cand({ name: "Abuja only", allowedStates: ["FCT"], coveredStates: ["FCT"] }),
    cand({ name: "No site visits", offeredServices: ["TITLE"] }),
    cand({ name: "Conflicted", conflict: true }),
    cand({ name: "Full", openCases: 20 }),
    cand({ name: "Suspended", active: false }),
  ]);
  assert.deepEqual(r.filter((x) => x.eligible).map((x) => x.name), ["Steady", "Late"]);
  const why = Object.fromEntries(r.map((x) => [x.name, x.reasons.join("; ")]));
  assert.match(why["Unvetted"], /not vetted/);
  assert.match(why["Abuja only"], /not approved for Lagos/);
  assert.match(why["No site visits"], /does not offer 1/);
  assert.match(why["Conflicted"], /conflict of interest/);
  assert.match(why["Full"], /full capacity/);
  assert.match(why["Suspended"], /suspended/);
});

const report: ReportContent = { scope: "Title and site", documentsExamined: "C of O", sourcesConsulted: "Lagos land registry", registrySearch: "Search 2026/123", siteInspection: "Visited 3 March", findings: [{ basis: "REGISTRY", text: "Registered to the seller." }], risks: "", limitations: "No survey done.", outstanding: "", observations: "", recommendations: "", conclusion: "Title appears in order within scope.", outcome: "SATISFACTORY_WITHIN_SCOPE" };

test("a report needs scope, a finding that says what it rests on, limitations, a conclusion and a nuanced outcome", () => {
  assert.deepEqual(reportGaps(report), []);
  assert.ok(reportGaps({ ...report, findings: [] }).some((g) => /finding/.test(g)));
  assert.ok(reportGaps({ ...report, limitations: "" }).some((g) => /limitations/.test(g)));
  assert.ok(reportGaps({ ...report, outcome: "ADVERSE_FINDINGS" }).some((g) => /adverse/.test(g)));
  assert.ok(reportGaps({ ...report, outcome: "SATISFACTORY_WITH_CONDITIONS" }).some((g) => /conditions/.test(g)));
});

test("a released report's fingerprint is stable and changes with any change", () => {
  const v = { caseRef: "HVR-2026-000001", providerCode: "HVP-000001", version: 1, content: report, preparedBy: "A", reviewedBy: "B", approvedAt: "2026-03-05T10:00:00.000Z" };
  const h = (x: typeof v) => createHash("sha256").update(canonicalReport(x)).digest("hex");
  const shuffled = { ...v, content: Object.fromEntries(Object.entries(report).reverse()) as ReportContent };
  assert.equal(h(v), h(shuffled), "key order does not change it");
  assert.notEqual(h(v), h({ ...v, content: { ...report, conclusion: "Changed." } }));
});

test("the database's own guard allows exactly the moves the rules allow, so neither can drift from the other", () => {
  const sql = readFileSync("prisma/migrations/20261231000000_verification_cases/migration.sql", "utf8");
  const inDb = new Set([...sql.matchAll(/\('([A-Z_]+)','([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`));
  const movers = [P, C, ...(["OWNER", "ADMIN", "MANAGER", "INVESTIGATOR", "REVIEWER", "FINANCE"] as const).map(prov)];
  const inRules = new Set<string>();
  for (const f of CASE_STATUSES) for (const t of CASE_STATUSES) if (movers.some((m) => canMoveCase(f, t, m))) inRules.add(`${f}>${t}`);
  assert.deepEqual([...inDb].sort(), [...inRules].sort());
});
