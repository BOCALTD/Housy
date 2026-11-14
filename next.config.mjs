/** @type {import('next').NextConfig} */
// The only outside services the pages use are Google Fonts and, when the user saves a file to Google Drive, Google sign-in and Drive.
// Street map tiles: OpenStreetMap by default; set NEXT_PUBLIC_MAP_TILES to a provider's template (MapTiler, Stadia, Carto...) for production traffic.
const tiles = process.env.NEXT_PUBLIC_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileHost = (() => {
  try {
    const u = new URL(tiles.replace(/\{s\}/g, "a").replace(/\{[a-z]+\}/g, "0"));
    return tiles.includes("{s}") ? `${u.protocol}//*.${u.host.split(".").slice(1).join(".")}` : u.origin;
  } catch { return "https://tile.openstreetmap.org"; }
})();
// A satellite layer, when one is set up, may come from another host (NEXT_PUBLIC_MAP_SATELLITE_TILES); MapTiler's hybrid layer
// shares the streets host.
const satHost = (() => {
  const t = process.env.NEXT_PUBLIC_MAP_SATELLITE_TILES;
  if (!t) return "";
  try { return new URL(t.replace(/\{[a-z]+\}/g, "0")).origin; } catch { return ""; }
})();
/** The hosts each live chat provider loads from (their published lists). */
const CHAT = {
  script: "https://embed.tawk.to https://*.tawk.to https://cdn.jsdelivr.net https://client.crisp.chat https://code.tidio.co https://*.tidio.co https://widget.intercom.io https://js.intercomcdn.com",
  style: "https://embed.tawk.to https://*.tawk.to https://client.crisp.chat https://*.tidio.co",
  img: "https://*.tawk.to https://tawk.link https://client.crisp.chat https://image.crisp.chat https://storage.crisp.chat https://*.tidio.co https://*.tidiocdn.com https://*.intercomcdn.com https://*.intercom.io https://static.intercomassets.com",
  font: "https://*.tawk.to https://client.crisp.chat https://*.tidio.co https://js.intercomcdn.com https://fonts.intercomcdn.com",
  media: "https://*.tawk.to https://client.crisp.chat https://*.tidio.co https://js.intercomcdn.com",
  connect: "https://*.tawk.to wss://*.tawk.to https://client.crisp.chat wss://client.relay.crisp.chat wss://stream.relay.crisp.chat https://storage.crisp.chat https://*.tidio.co wss://*.tidio.co https://*.intercom.io wss://*.intercom.io https://api-iam.intercom.io https://uploads.intercomcdn.com",
  frame: "https://*.tawk.to https://game.crisp.chat https://*.tidio.co https://intercom-sheets.com https://www.intercom-reporting.com",
};
const csp = [
  "default-src 'self'",
  // Google Sign-In; the person check (Google reCAPTCHA or Cloudflare Turnstile) when the administrator turns one on; the live chat
  // provider the administrator chooses (Tawk.to, Crisp, Tidio or Intercom), loaded only after the visitor accepts optional cookies.
  `script-src 'self' 'unsafe-inline' https://accounts.google.com https://www.google.com https://www.gstatic.com https://challenges.cloudflare.com ${CHAT.script}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com ${CHAT.style}`,
  `img-src 'self' data: blob: ${tileHost}${satHost && satHost !== tileHost ? ` ${satHost}` : ""} ${CHAT.img}`,
  `font-src 'self' data: https://fonts.gstatic.com ${CHAT.font}`,
  // Reel previews play the chosen clip from the device before it is uploaded.
  `media-src 'self' blob: ${CHAT.media}`,
  `connect-src 'self' https://www.googleapis.com https://accounts.google.com https://www.google.com https://challenges.cloudflare.com ${CHAT.connect}`,
  `frame-src https://accounts.google.com https://www.google.com https://challenges.cloudflare.com ${CHAT.frame}`,
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

const nextConfig = {
  // The development server (npm run dev) only serves its scripts to addresses it trusts. Opened from another device or the
  // server's IP, the page would load but nothing would respond. Private networks are trusted; add others in DEV_ORIGINS.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local", ...(process.env.DEV_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)],
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must always be checked for updates, or a fixed bug could live on in installed apps.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
