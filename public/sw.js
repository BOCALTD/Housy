/* Housy service worker (master prompt §49).
 * Caches static assets and anonymous copies of public pages only, so the app opens and public pages
 * can be read without a connection. Signed-in areas (/app, /admin, /me, /portal, /api, messages, documents)
 * are never cached. The one thing that works offline is the field kit (/field): its page holds nothing personal, the
 * inspector's work is kept in IndexedDB on their device, and it is sent through /api/field once back online. */
const VERSION = "housy-v6";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE = "/offline";
const MAX_PAGES = 30;
const REFRESH_MS = 30 * 60 * 1000;

const PUBLIC = /^\/(?:$|browse|properties|faq|how-it-works|about|safety$|reviews|calculators|compare|trust$|agents|companies|directory|completed|awards|map|support|market|field$)(?:\/|$)/;
const NEVER = /^\/(?:app|admin|me|portal|api|calendar|kyc|messages|invite|login|join|signup|setup|forgot|reset|unsubscribe|billing|r|safety\/|trust\/|verification|collaborations|feedback|rewards|referrals|ads)(?:\/|$)/;
/* Reel clips and their songs: fetched once, kept on the device (the 30 most recent, for a week), and played again from here, including the
 * byte ranges phones ask for, so scrolling back or watching again never downloads the clip twice. */
const REELS = `${VERSION}-reels`;
const REEL_PATH = /^\/(?:reels\/[0-9a-f-]{36}\/video|music\/[0-9a-f-]{36}\/audio)$/;
const MAX_REELS = 30;
const REEL_MAX_AGE = 7 * 24 * 3600 * 1000;

async function reelResponse(req) {
  const url = new URL(req.url);
  const cache = await caches.open(REELS);
  let hit = await cache.match(url.pathname);
  if (hit && Date.now() - Number(hit.headers.get("x-sw-cached-at") || 0) > REEL_MAX_AGE) { await cache.delete(url.pathname); hit = undefined; }
  let blob, type;
  if (hit) { blob = await hit.blob(); type = hit.headers.get("content-type") || "video/mp4"; }
  else {
    let res;
    try { res = await fetch(url.pathname, { credentials: "same-origin" }); } catch { return fetch(req); }
    if (res.status !== 200) return res;
    blob = await res.blob(); type = res.headers.get("content-type") || "video/mp4";
    await cache.put(url.pathname, new Response(blob, { headers: { "content-type": type, "x-sw-cached-at": String(Date.now()) } }));
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_REELS; i++) await cache.delete(keys[i]);
  }
  const size = blob.size;
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (!m || (m[1] === "" && m[2] === "")) return new Response(blob, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  let start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
}

const STATIC_PATH = /^\/(?:_next\/static\/|icons\/|stock\/|icon\.svg$|apple-icon\.png$)/;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    const res = await fetch(OFFLINE, { credentials: "omit", cache: "reload" });
    if (res.ok) await cache.put(OFFLINE, res);
    const kit = await fetch("/field", { credentials: "omit", cache: "reload" }).catch(() => null);
    if (kit && kit.ok) await cache.put("/field", kit);
    const s = await caches.open(STATIC);
    await s.addAll(["/icons/icon-192.png", "/icons/icon-512.png"]).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i++) if (!keys[i].url.endsWith(OFFLINE)) await cache.delete(keys[i]);
}

/** Keep an anonymous copy of a public page: fetched without cookies, so no one's name or account ever lands in the cache. */
async function refreshAnonymous(url) {
  const cache = await caches.open(PAGES);
  const old = await cache.match(url);
  const at = old ? Number(old.headers.get("x-sw-cached-at") || 0) : 0;
  if (Date.now() - at < REFRESH_MS) return;
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok || res.redirected || !(res.headers.get("content-type") || "").includes("text/html")) return;
  const headers = new Headers(res.headers);
  headers.set("x-sw-cached-at", String(Date.now()));
  await cache.put(url, new Response(await res.blob(), { status: 200, headers }));
  await trim(cache);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (REEL_PATH.test(path)) { event.respondWith(reelResponse(req)); return; }

  if (STATIC_PATH.test(path)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (req.mode !== "navigate") return;
  const isPublic = PUBLIC.test(path) && !NEVER.test(path);
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (isPublic && res.ok) event.waitUntil(refreshAnonymous(url.pathname + url.search).catch(() => {}));
      return res;
    } catch {
      const cache = await caches.open(PAGES);
      if (isPublic) {
        const hit = await cache.match(url.pathname + url.search) || await cache.match(url.pathname);
        if (hit) return hit;
      }
      return (await cache.match(OFFLINE)) || new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});

/* Push notifications: show what the server sent, and open the right page when it is tapped. Only same-site pages are opened. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data ? event.data.text() : "" }; }
  const title = (data.title || "New notification").slice(0, 120);
  event.waitUntil(self.registration.showNotification(title, {
    body: (data.body || "").slice(0, 240),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    data: { url: typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/me/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/me/notifications", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && "focus" in w) { await w.focus(); if ("navigate" in w) await w.navigate(target).catch(() => {}); return; }
    }
    await self.clients.openWindow(target);
  })());
});
