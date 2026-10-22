import { apiError, apiRoute } from "@/lib/api-v1";
import { pagedEnvelope, pagingFrom } from "@/lib/api-rules";
import { apiAssets } from "@/lib/services/api-data";

export const dynamic = "force-dynamic";

/** The assets of the company that owns the key. Needs a key with the assets:read scope. */
export function GET(req: Request) {
  return apiRoute(req, { scope: "assets:read" }, async ({ caller, url }) => {
    if (!caller) return apiError("unauthorized");
    const { page, pageSize, skip } = pagingFrom(url.searchParams);
    const { total, rows } = await apiAssets(caller, skip, pageSize);
    return Response.json(pagedEnvelope(rows, total, page, pageSize, "/api/v1/assets", url.searchParams));
  });
}
