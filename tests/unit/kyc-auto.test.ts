import { test } from "node:test";
import assert from "node:assert/strict";
import { cacNumber, companiesMatch, lookupFor, maskName, namesMatch } from "../../src/lib/kyc-auto-rules";
import { dojah, identityProviders, youverify } from "../../src/lib/identity-providers";

test("which record a check is compared with", () => {
  assert.equal(lookupFor("AGENT_ID", { idType: "NIN" }), "NIN");
  assert.equal(lookupFor("DIRECTOR_ID", { idType: "VOTERS_CARD" }), "PVC");
  assert.equal(lookupFor("AGENT_ID", { idType: "DRIVERS_LICENCE" }), "DRIVERS_LICENCE");
  assert.equal(lookupFor("AGENT_ID", { idType: "PASSPORT" }), null, "passports are checked by a person");
  assert.equal(lookupFor("CAC_REGISTRATION", {}), "CAC");
  assert.equal(lookupFor("TAX_ID", {}), "TIN");
  assert.equal(lookupFor("OFFICE_ADDRESS", {}), null);
});

test("a typed name matches the record when the surname and another name agree, in any order, despite titles and small slips", () => {
  const rec = { first: "OLUWASEUN", middle: "GRACE", last: "ADEYEMI" };
  assert.ok(namesMatch("Oluwaseun Adeyemi", rec).match);
  assert.ok(namesMatch("Adeyemi Grace", rec).match);
  assert.ok(namesMatch("Mrs. Oluwaseyun Adeyemi", rec).match, "one slip in a long name");
  assert.ok(namesMatch("Adéyemi Oluwaseun Grace", rec).match, "accents ignored");
  assert.equal(namesMatch("Oluwaseun Adebayo", rec).match, false, "different surname");
  assert.equal(namesMatch("Adeyemi", rec).match, false, "a surname alone is not enough");
  assert.equal(namesMatch("Tunde Adeyemi", rec).match, false, "another member of the family");
  assert.equal(namesMatch("Oluwaseun Grace Adeyemi Bola Kemi", rec).match, false, "extra names not on the record");
  assert.equal(namesMatch("Obi Ade", { first: "ADA", last: "OBI" }).match, false, "short names allow no slips");
});

test("company names match ignoring Limited, Nig., punctuation and order; CAC numbers are read however they are typed", () => {
  assert.ok(companiesMatch("Alpha Estates Ltd", "ALPHA ESTATES LIMITED"));
  assert.ok(companiesMatch("Alpha Estates (Nig.) Limited", "ALPHA ESTATES NIGERIA LIMITED"));
  assert.ok(companiesMatch("Smith & Sons Properties", "SMITH AND SONS PROPERTIES LTD"));
  assert.equal(companiesMatch("Alpha Homes Ltd", "ALPHA ESTATES LIMITED"), false);
  assert.deepEqual(cacNumber("RC 1234567"), { number: "1234567", type: "COMPANY" });
  assert.deepEqual(cacNumber("bn-3141592"), { number: "3141592", type: "BUSINESS_NAME" });
  assert.deepEqual(cacNumber("IT 12345"), { number: "12345", type: "INCORPORATED_TRUSTEES" });
  assert.deepEqual(cacNumber("1261103"), { number: "1261103", type: "COMPANY" });
  assert.equal(cacNumber("ABC"), null);
  assert.equal(maskName("Ada Grace Obi"), "A*A G***E O*I");
});

test("providers are switched on only by their own keys, tried in the chosen order", () => {
  assert.equal(identityProviders({}).length, 0);
  assert.deepEqual(identityProviders({ DOJAH_APP_ID: "a", DOJAH_SECRET_KEY: "k", YOUVERIFY_TOKEN: "t" }).map((p) => p.name), ["Dojah", "Youverify"]);
  assert.deepEqual(identityProviders({ KYC_PROVIDERS: "youverify,dojah", DOJAH_APP_ID: "a", DOJAH_SECRET_KEY: "k", YOUVERIFY_TOKEN: "t" }).map((p) => p.name), ["Youverify", "Dojah"]);
  assert.deepEqual(identityProviders({ DOJAH_APP_ID: "a" }).map((p) => p.name), [], "half a key pair is not a provider");
  assert.equal(dojah({ DOJAH_APP_ID: "a", DOJAH_SECRET_KEY: "k" })!.supports("PVC"), false);
  assert.equal(youverify({ YOUVERIFY_TOKEN: "t" })!.supports("CAC"), false);
});

test("the providers' answers are read as documented, and failures are 'unavailable', not 'no record'", async () => {
  const real = globalThis.fetch;
  const seen: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body: unknown) => { globalThis.fetch = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch; };
  try {
    const d = dojah({ DOJAH_APP_ID: "app", DOJAH_SECRET_KEY: "sk", DOJAH_BASE_URL: "https://sandbox.dojah.io/" })!;
    reply(200, { entity: { first_name: "ADA", middle_name: "", last_name: "OBI", photo: "base64…", date_of_birth: "1990-01-01" } });
    const nin = await d.lookup("NIN", { number: "70123456789" });
    assert.deepEqual(nin, { found: true, reference: "", person: { first: "ADA", middle: "", last: "OBI" } }, "photo and date of birth are dropped");
    assert.equal(seen[0].url, "https://sandbox.dojah.io/api/v1/kyc/nin?nin=70123456789");
    assert.deepEqual(seen[0].init.headers, { AppId: "app", Authorization: "sk", Accept: "application/json" });
    reply(200, { entity: { company_name: "ANON LIMITED", status: "ACTIVE", rc_number: "1261103" } });
    const cac = await d.lookup("CAC", { number: "1261103", companyType: "COMPANY" });
    assert.equal(cac.found && cac.company?.name, "ANON LIMITED");
    assert.equal(seen[1].url, "https://sandbox.dojah.io/api/v1/kyc/cac/basic?rc_number=1261103&company_type=COMPANY");
    reply(404, { error: "NIN not found" });
    assert.deepEqual(await d.lookup("NIN", { number: "1" }), { found: false, reference: "" });
    reply(401, { error: "Unauthorized" });
    await assert.rejects(d.lookup("NIN", { number: "1" }), /refused the keys/);
    reply(500, {});
    await assert.rejects(d.lookup("NIN", { number: "1" }), /answered 500/);

    const y = youverify({ YOUVERIFY_TOKEN: "tok" })!;
    reply(200, { success: true, data: { id: "yv-1", status: "found", firstName: "ADA", middleName: "GRACE", lastName: "OBI" } });
    const pvc = await y.lookup("PVC", { number: "90F5B1" });
    assert.deepEqual(pvc, { found: true, reference: "yv-1", person: { first: "ADA", middle: "GRACE", last: "OBI" } });
    const last = seen[seen.length - 1];
    assert.equal(last.url, "https://api.youverify.co/v2/api/identity/ng/pvc");
    assert.deepEqual(JSON.parse(String(last.init.body)), { id: "90F5B1", isSubjectConsent: true });
    reply(200, { success: true, data: { id: "yv-2", status: "not_found" } });
    assert.deepEqual(await y.lookup("NIN", { number: "1" }), { found: false, reference: "yv-2" });
    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    await assert.rejects(y.lookup("NIN", { number: "1" }), /could not be reached/);
  } finally { globalThis.fetch = real; }
});
