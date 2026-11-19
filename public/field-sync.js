/* Housy field kit: sending work kept on the device to the office.
 * One copy of the sending steps, used by the field kit page and by the service worker (background sync), so work goes out
 * when the connection returns even if the page was closed. Only one sender runs at a time on a device (a Web Lock), and every
 * send carries the device's id for it, so the office never records the same thing twice.
 * Storage: IndexedDB "housy-field", store "kv" (see src/lib/field-store.ts). Keys: last-user, pack:<uid>, out:<uid>:<inspectionId>,
 * photo:<uid>:<photoId>. */
(function (scope) {
  "use strict";
  var DB = "housy-field", STORE = "kv";

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function run(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, mode);
      var req = fn(tx.objectStore(STORE));
      tx.oncomplete = function () { resolve(req ? req.result : undefined); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("The device storage is full or blocked")); };
    });
  }
  function get(db, key) { return run(db, "readonly", function (s) { return s.get(key); }); }
  function put(db, key, value) { return run(db, "readwrite", function (s) { s.put(value, key); }); }
  function del(db, key) { return run(db, "readwrite", function (s) { s.delete(key); }); }
  function list(db, prefix) {
    var range = IDBKeyRange.bound(prefix, prefix + "￿");
    return run(db, "readonly", function (s) { return s.getAll(range); });
  }

  function Offline(msg) { this.message = msg; this.offline = true; }
  function SignedOut(msg) { this.message = msg; this.signedOut = true; }

  async function call(url, init) {
    var res;
    try { res = await fetch(url, Object.assign({}, init, { credentials: "same-origin", cache: "no-store" })); } catch (e) { throw new Offline("No connection"); }
    var body = await res.json().catch(function () { return {}; });
    if (res.status === 401) throw new SignedOut(body.error || "Sign in again");
    if (!res.ok) throw new Error(body.error || "That could not be sent");
    return body;
  }

  async function sendAll(db, uid) {
    var out = { sent: 0, failed: 0, conflicts: 0, signedOut: false, offline: false };
    var entries = ((await list(db, "out:" + uid + ":")) || []).filter(function (o) { return o && o.state === "waiting"; })
      .sort(function (a, b) { return String(a.queuedAt).localeCompare(String(b.queuedAt)); });
    try {
      for (var n = 0; n < entries.length; n++) {
        var o = entries[n];
        var key = "out:" + uid + ":" + o.inspectionId;
        // The page may have changed or removed it since the list was read.
        var fresh = await get(db, key);
        if (!fresh || fresh.clientId !== o.clientId || fresh.state !== "waiting") continue;
        o = fresh;
        try {
          if (!o.office) {
            var r = await call("/api/field/sync", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clientId: o.clientId, inspectionId: o.inspectionId, base: o.base, mine: o.mine, findings: o.findings }),
            });
            if (r.outcome === "closed") {
              o.state = "closed";
              o.note = "The office has already " + (r.status === "CANCELLED" ? "cancelled" : "closed") + " this inspection, so it was not changed. Your copy is kept here.";
              await put(db, key, o); continue;
            }
            o.office = r.record; o.conflicts = r.conflicts || []; o.findingIds = r.findings || {};
            await put(db, key, o);
            var p = await get(db, "pack:" + uid);
            if (p && r.record) {
              p.inspections = p.inspections.map(function (i) { return i.id === o.inspectionId ? Object.assign({}, i, { record: r.record, revision: r.revision != null ? r.revision : i.revision }) : i; });
              await put(db, "pack:" + uid, p);
            }
          }
          // Photos go after the record, so photos of a new defect can be attached to it.
          o.sentPhotos = o.sentPhotos || [];
          var pending = o.photoIds.filter(function (x) { return o.sentPhotos.indexOf(x) < 0; });
          for (var k = 0; k < pending.length; k++) {
            var pid = pending[k];
            var ph = await get(db, "photo:" + uid + ":" + pid);
            if (!ph) { o.sentPhotos.push(pid); continue; }
            var fd = new FormData();
            fd.set("file", new File([ph.blob], "site-" + pid.slice(0, 8) + ".jpg", { type: ph.blob.type || "image/jpeg" }));
            fd.set("clientId", pid); fd.set("inspectionId", o.inspectionId); fd.set("caption", ph.caption || "");
            if (ph.findingClientId && o.findingIds && o.findingIds[ph.findingClientId]) fd.set("findingId", o.findingIds[ph.findingClientId]);
            await call("/api/field/photo", { method: "POST", body: fd });
            o.sentPhotos.push(pid);
            await del(db, "photo:" + uid + ":" + pid);
            await put(db, key, o);
          }
          if (o.conflicts && o.conflicts.length) { o.state = "conflicts"; await put(db, key, o); out.conflicts++; continue; }
          if (o.submit) {
            try {
              await call("/api/field/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId: o.inspectionId }) });
              o.note = "Sent and submitted for approval.";
            } catch (e) { if (e.offline || e.signedOut) throw e; o.note = "Sent, but not submitted: " + e.message; }
          } else o.note = "Sent. Submit it for approval from the inspection page when it is complete.";
          o.state = "sent"; o.sentAt = new Date().toISOString();
          await put(db, key, o);
          out.sent++;
        } catch (e) {
          if (e.offline || e.signedOut) throw e;
          o.state = "error"; o.error = e.message;
          await put(db, key, o);
          out.failed++;
        }
      }
    } catch (e) {
      if (e.signedOut) out.signedOut = true; else if (e.offline) out.offline = true; else throw e;
    }
    return out;
  }

  /** Send everything waiting for the person last signed in to the kit on this device. */
  async function housyFieldSync() {
    var db = await open();
    try {
      var uid = await get(db, "last-user");
      if (!uid) return { sent: 0, failed: 0, conflicts: 0, signedOut: false, offline: false, waiting: 0 };
      var go = function () { return sendAll(db, uid); };
      var r = scope.navigator && scope.navigator.locks ? await scope.navigator.locks.request("housy-field-sync", go) : await go();
      var left = ((await list(db, "out:" + uid + ":")) || []).filter(function (o) { return o && o.state === "waiting"; }).length;
      r.waiting = left;
      return r;
    } finally { db.close(); }
  }

  scope.housyFieldSync = housyFieldSync;
})(self);
