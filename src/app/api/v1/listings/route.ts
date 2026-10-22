import { apiRoute } from "@/lib/api-v1";
import { pagedEnvelope, pagingFrom } from "@/lib/api-rules";
import { apiListings } from "@/lib/services/api-data";

export const dynamic = "force-dynamic";

/** Published property listings, newest first. Public and read-only. */
export function GET(req: Request) {
  return apiRoute(req, {}, async ({ url, origin }) => {
    const { page, pageSize, skip } = pagingFrom(url.searchParams);
    const { total, rows } = await apiListings(url.searchParams, skip, pageSize, origin);
    return Response.json(pagedEnvelope(rows, total, page, pageSize, "/api/v1/listings", url.searchParams));
  });
}
