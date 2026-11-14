import { NextResponse, type NextRequest } from "next/server";
import { maintenanceNow } from "@/lib/services/maintenance-mode";
import { openDuringMaintenance } from "@/lib/site-maintenance-rules";

/**
 * In front of every page: during an upgrade or maintenance window, pages show the "back soon" page (the root layout does that,
 * letting platform administrators through to check the site), and forms on those pages are refused so nothing half-changes.
 * Everything under /api (Paystack's payment messages, scheduled jobs, the health check) is never touched.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const headers = new Headers(req.headers);
  headers.set("x-housy-path", path);
  headers.delete("x-housy-maintenance");
  try {
    if (!openDuringMaintenance(path)) {
      const { phase } = await maintenanceNow();
      if (phase === "active") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return new NextResponse("Housy is being upgraded. Please try again when it reopens.", { status: 503, headers: { "Retry-After": "900", "Content-Type": "text/plain; charset=utf-8" } });
        }
        headers.set("x-housy-maintenance", "1");
      }
    }
  } catch {
    // If the setting cannot be read, the site stays open rather than closing by mistake.
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|sw.js|health.js|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|txt|xml|woff2?)$).*)"],
};
