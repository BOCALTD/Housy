import { apiError, apiRoute } from "@/lib/api-v1";
import { API_VERSION } from "@/lib/api-rules";
import { apiListing } from "@/lib/services/api-data";

export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  return apiRoute(req, {}, async ({ origin }) => {
    const { ref } = await ctx.params;
    const found = await apiListing(ref, origin);
    return found ? Response.json({ data: found, meta: { version: API_VERSION } }) : apiError("not_found");
  });
}
