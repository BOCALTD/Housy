import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFileName, fileProblem, formatBytes, formatDuration, sniff, tallyReactions, MAX_FILE_BYTES } from "../../src/lib/chat-files";

const bytes = (...a: number[]) => new Uint8Array([...a, ...new Array(16).fill(0)]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3);
const M4A = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);

test("a file's type comes from its contents, not its name or what the browser says", () => {
  assert.equal(sniff(PNG, "application/octet-stream"), "image/png");
  assert.equal(sniff(PDF, "image/png"), "application/pdf");
  assert.equal(sniff(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(sniff(ZIP, "application/zip"), null, "a plain archive is not accepted");
  assert.equal(sniff(WEBM, "audio/webm;codecs=opus"), "audio/webm");
  assert.equal(sniff(M4A, "audio/mp4"), "audio/mp4");
  assert.equal(sniff(new TextEncoder().encode("Viewing on Saturday at 10"), "text/plain"), "text/plain");
  assert.equal(sniff(new TextEncoder().encode("<html><script>alert(1)</script>"), "text/plain"), null, "a web page dressed as text is refused");
  assert.equal(sniff(new TextEncoder().encode("<svg onload=alert(1)>"), "image/svg+xml"), null);
});

test("what can be sent: accepted kinds, sizes and voice-note lengths", () => {
  assert.equal(fileProblem({ kind: "FILE", size: 1000, type: "application/pdf" }), null);
  assert.match(fileProblem({ kind: "FILE", size: MAX_FILE_BYTES + 1, type: "application/pdf" })!, /10 MB/);
  assert.match(fileProblem({ kind: "FILE", size: 10, type: null })!, /Send photos/);
  assert.match(fileProblem({ kind: "FILE", size: 10, type: "audio/webm" })!, /Send photos/);
  assert.equal(fileProblem({ kind: "VOICE", size: 1000, type: "audio/webm", durationMs: 4000 }), null);
  assert.match(fileProblem({ kind: "VOICE", size: 1000, type: "audio/webm", durationMs: 100 })!, /too short/);
  assert.match(fileProblem({ kind: "VOICE", size: 1000, type: "audio/webm", durationMs: 200_000 })!, /3 minutes/);
  assert.match(fileProblem({ kind: "VOICE", size: 1000, type: "application/pdf", durationMs: 4000 })!, /could not be read/);
});

test("file names are made safe and keep the right extension", () => {
  assert.equal(cleanFileName("../../etc/passwd", "text/plain"), "passwd.txt");
  assert.equal(cleanFileName("C:\\Users\\Ada\\Tenancy agreement.pdf", "application/pdf"), "Tenancy agreement.pdf");
  assert.equal(cleanFileName('bad"<name>.exe', "image/png"), "badname.exe.png");
  assert.equal(cleanFileName("", "audio/webm"), "file.webm");
});

test("sizes, durations and reaction counts read naturally", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB");
  assert.equal(formatDuration(65_000), "1:05");
  assert.deepEqual(tallyReactions([{ emoji: "❤️", userId: "a" }, { emoji: "👍", userId: "b" }, { emoji: "👍", userId: "me" }], "me"), [{ emoji: "👍", count: 2, mine: true }, { emoji: "❤️", count: 1, mine: false }]);
});
