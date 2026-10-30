import type { MetadataRoute } from "next";

// Search engines may read the public pages; private areas and one-off links stay out of their index.
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/admin", "/me", "/api/", "/portal", "/messages", "/field", "/kyc", "/calendar", "/r/", "/invite", "/reset", "/setup", "/unsubscribe", "/billing", "/verification/", "/collaborations", "/trust/evidence", "/vacancies/file", "/*?shared=1", "/*?intro=1", "/*?boot=1"],
    }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
