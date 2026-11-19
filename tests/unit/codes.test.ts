import { test } from "node:test";
import assert from "node:assert/strict";
import { barcodeSvg, barcodeable, qrSvg, scanPath } from "../../src/lib/codes";
import { codeFromScan } from "../../src/components/CameraScan";

test("labels carry a QR code of the scan address and a Code 128 barcode of the item code", () => {
  const qr = qrSvg(`https://housy.example${scanPath("INV-0001")}`);
  assert.match(qr, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.ok(qr.includes("<path"));
  const bar = barcodeSvg("CEM-01");
  assert.ok(bar && bar.startsWith("<svg "));
  assert.equal(scanPath("A B/1"), "/scan?code=A%20B%2F1");
  // Code 128 is printable ASCII only: such codes get the QR code alone.
  assert.equal(barcodeable("Ọ̀kọ̀-1"), false);
  assert.equal(barcodeSvg("Ọ̀kọ̀-1"), null);
  assert.equal(barcodeable("x".repeat(49)), false);
});

test("a scanned label gives the item code, whether it is a QR address or a plain barcode", () => {
  assert.equal(codeFromScan("https://housy.example/scan?code=INV-0001"), "INV-0001");
  assert.equal(codeFromScan("https://housy.example/scan?code=A%20B%2F1"), "A B/1");
  assert.equal(codeFromScan("  CEM-01 \n"), "CEM-01");
  // Another site's address is taken as it is, not trusted as a Housy label.
  assert.equal(codeFromScan("https://example.com/other?code=X"), "https://example.com/other?code=X");
});
