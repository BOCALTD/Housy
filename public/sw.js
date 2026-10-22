/* Housy service worker (master prompt §49).
 * Caches static assets and anonymous copies of public pages only, so the app opens and public pages
 * can be read without a connection. Signed-in areas (/app, /admin, /me, /portal, /api, messages, documents)
 * are never cached, and nothing is written while offline: forms always need the network. */
const VERSION = "housy-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE = "/offline";
const MAX_PAGES = 30;
const REFRESH_MS = 30 * 60 * 1000;

const PUBLIC = /^\/(?:$|browse|properties|faq|how-it-works|about|safety$|reviews|calculators|compare|trust$|agents|companies|directory|completed|awards|reels|map|support)(?:\/|$)/;
const NEVER = /^\/(?:app|admin|me|portal|api|calendar|kyc|messages|invite|login|join|signup|setup|forgot|reset|unsubscribe|billing|r|safety\/|trust\/|verification|collaborations|feedback|rewards|referrals|ads)(?:\/|$)/;
const STATIC_PATH = /^\/(?:_next\/static\/|icons\/|stock\/|icon\.svg$|apple-icon\.png$)/;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    const res = await fetch(OFFLINE, { credentials: "omit", cache: "reload" });
    if (res.ok) await cache.put(OFFLINE, res);
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
