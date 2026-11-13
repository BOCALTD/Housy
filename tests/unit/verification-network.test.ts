import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLICATION_STATUSES, SERVICE_CATEGORIES, VP_ROLES, applicantMayEdit, applicationRef, canMoveApplication, corporateSchema, isApplicationRef,
  isProviderCode, mayManageRole, missingForSubmit, providerCode, qualificationsSchema, vpCan, type ApplicationAnswers,
} from "../../src/lib/verification-network-rules";

test("sixteen independently configurable service categories, each saying what kind of finding it gives", () => {
  assert.equal(SERVICE_CATEGORIES.length, 16);
  assert.equal(new Set(SERVICE_CATEGORIES.map((s) => s.code)).size, 16);
  for (const s of SERVICE_CATEGORIES) assert.ok(["DOCUMENTARY", "REGISTRY", "PHYSICAL", "OPINION", "MIXED"].includes(s.finding), s.code);
  // A registry search is reported as a registry finding, never as proof of ownership.
  assert.equal(SERVICE_CATEGORIES.find((s) => s.code === "REGISTRY_SEARCH")!.finding, "REGISTRY");
});

test("references and provider IDs have one shape", () => {
  assert.equal(applicationRef(2026, 7), "VPA-2026-000007");
  assert.equal(providerCode(12), "HVP-000012");
  assert.ok(isApplicationRef("VPA-2026-000007"));
  assert.ok(!isApplicationRef("VPA-26-7"));
  assert.ok(isProviderCode("HVP-000012"));
  assert.ok(!isProviderCode("HVP-12'; drop"));
});

test("an application moves only along allowed steps, and only the right side makes each move", () => {
  assert.ok(canMoveApplication("DRAFT", "SUBMITTED", "applicant"));
  assert.ok(!canMoveApplication("DRAFT", "SUBMITTED", "admin"));
  assert.ok(!canMoveApplication("SUBMITTED", "APPROVED", "admin"), "approval comes after review");
  assert.ok(canMoveApplication("UNDER_REVIEW", "APPROVED", "admin"));
  assert.ok(!canMoveApplication("UNDER_REVIEW", "APPROVED", "applicant"), "an applicant can never approve themselves");
  assert.ok(canMoveApplication("ADDITIONAL_INFORMATION_REQUIRED", "RESUBMITTED", "applicant"));
  for (const end of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) for (const to of APPLICATION_STATUSES) {
    assert.ok(!canMoveApplication(end, to, "admin") && !canMoveApplication(end, to, "applicant"), `${end} is final`);
  }
  assert.ok(applicantMayEdit("DRAFT") && applicantMayEdit("ADDITIONAL_INFORMATION_REQUIRED"));
  assert.ok(!applicantMayEdit("UNDER_REVIEW") && !applicantMayEdit("APPROVED"));
});

test("the application's answers are checked, and nothing can be sent while something required is missing", () => {
  assert.throws(() => corporateSchema.parse({ registeredName: "X" }), /registered company name|organisation/);
  assert.throws(() => qualificationsSchema.parse({ services: ["TITLE"], professionals: [] }), /responsible professional/);
  const answers: ApplicationAnswers = {
    corporate: corporateSchema.parse({ registeredName: "Ada Advisory Ltd", orgType: "CONSULTANCY", cacNumber: "RC 1234567", registrationType: "PRIVATE_LIMITED", yearIncorporated: "2015", country: "Nigeria", registeredAddress: "1 Marina, Lagos", officialEmail: "hello@ada.example", officialPhone: "+234 803 000 0000", profile: "A property due diligence firm working across Lagos and Ogun since 2015." }),
  };
  const missing = missingForSubmit(answers, []);
  assert.ok(missing.includes("Ownership and contacts: not filled in yet"));
  assert.ok(missing.some((m) => /CAC registration documents/.test(m)));
  assert.ok(!missing.some((m) => m.startsWith("Company")));
});

test("six provider roles with permissions checked on the server; only owners manage owners and administrators", () => {
  assert.deepEqual([...VP_ROLES], ["OWNER", "ADMIN", "MANAGER", "INVESTIGATOR", "REVIEWER", "FINANCE"]);
  assert.ok(vpCan("OWNER", "finance.view") && vpCan("FINANCE", "finance.view"));
  assert.ok(!vpCan("INVESTIGATOR", "finance.view") && !vpCan("ADMIN", "finance.view"));
  assert.ok(vpCan("INVESTIGATOR", "case.work") && !vpCan("INVESTIGATOR", "case.view.all"));
  assert.ok(vpCan("REVIEWER", "case.review") && !vpCan("MANAGER", "case.review"));
  assert.ok(!vpCan("FINANCE", "staff.view"));
  assert.ok(mayManageRole("OWNER", "OWNER") && mayManageRole("OWNER", "ADMIN"));
  assert.ok(mayManageRole("ADMIN", "INVESTIGATOR") && !mayManageRole("ADMIN", "ADMIN") && !mayManageRole("ADMIN", "OWNER"));
  assert.ok(!mayManageRole("MANAGER", "INVESTIGATOR"));
});
