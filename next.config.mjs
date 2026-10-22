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
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  `img-src 'self' data: blob: ${tileHost}`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com",
  "frame-src https://accounts.google.com",
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
