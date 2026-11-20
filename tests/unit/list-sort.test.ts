import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, readSort, sortBy, withParams } from "../../src/lib/list-sort";
import { fileType } from "../../src/lib/services/document-library";

const OPTS = [{ key: "date", label: "Date", dir: "desc" as const }, { key: "name", label: "Name", dir: "asc" as const }];

test("the sort comes from the address, and only from the options offered", () => {
  assert.deepEqual(readSort({}, OPTS), { key: "date", dir: "desc" });
  assert.deepEqual(readSort({ sort: "name" }, OPTS), { key: "name", dir: "asc" });
  assert.deepEqual(readSort({ sort: "name", dir: "desc" }, OPTS), { key: "name", dir: "desc" });
  assert.deepEqual(readSort({ sort: "password", dir: "sideways" }, OPTS), { key: "date", dir: "desc" });
});

test("links keep the search and filters, drop one-off messages, and reset the page", () => {
  assert.equal(withParams("/app/documents", { q: "lease", source: "property", page: "3", notice: "Saved" }, { sort: "name", dir: "asc" }), "/app/documents?q=lease&source=property&sort=name&dir=asc");
  assert.equal(withParams("/app/documents", { q: "lease" }, { q: "" }), "/app/documents");
});

test("sorting: text by the alphabet ignoring case, numbers by size, dates by time, empty last either way", () => {
  assert.deepEqual(sortBy(["beta", "Alpha", "gamma"], (x) => x, "asc"), ["Alpha", "beta", "gamma"]);
  assert.deepEqual(sortBy(["file 10", "file 9"], (x) => x, "asc"), ["file 9", "file 10"]);
  assert.deepEqual(sortBy([3, null, 1], (x) => x, "asc"), [1, 3, null]);
  assert.deepEqual(sortBy([3, null, 1], (x) => x, "desc"), [3, 1, null]);
  assert.ok(compare(new Date(2020, 0, 1), new Date(2021, 0, 1), "asc") < 0);
});

test("file types by what the file is", () => {
  assert.equal(fileType("application/pdf"), "pdf");
  assert.equal(fileType("image/jpeg"), "image");
  assert.equal(fileType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "word");
  assert.equal(fileType("application/octet-stream", "budget.xlsx"), "sheet");
  assert.equal(fileType("application/zip", "x.zip"), "other");
});
