import { API_VERSION } from "@/lib/api-rules";
import { PLATFORM_NAME } from "@/lib/labels";
import { originOf } from "@/lib/api-v1";

export const dynamic = "force-dynamic";

const paging = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "page_size", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
];
const err = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };

/** A machine-readable description of version 1, for people building apps and partner integrations. */
export function GET(req: Request) {
  const spec = {
    openapi: "3.0.3",
    info: { title: `${PLATFORM_NAME} API`, version: API_VERSION, description: "Read-only. Money is whole kobo as a string with its currency. Lists are paged with page and page_size, and carry links to the next and previous page. Changes that could break a program are made only in a new version number." },
    servers: [{ url: originOf(req) }],
    paths: {
      "/api/v1/listings": { get: { summary: "Published listings", security: [], parameters: [...paging,
        { name: "city", in: "query", schema: { type: "string" } }, { name: "purpose", in: "query", schema: { type: "string", enum: ["SALE", "RENT", "LEASE"] } },
        { name: "max_price", in: "query", description: "Naira", schema: { type: "string" } }, { name: "min_bedrooms", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "A page of listings" }, "429": err } } },
      "/api/v1/listings/{ref}": { get: { summary: "One published listing", security: [], parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "The listing" }, "404": err } } },
      "/api/v1/assets": { get: { summary: "Your company's assets", description: "Needs a key with the assets:read scope.", security: [{ bearer: [] }], parameters: paging, responses: { "200": { description: "A page of assets" }, "401": err, "403": err, "429": err } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "A key made by a company administrator under Workspace, API keys." } },
      schemas: { Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } }, meta: { type: "object" } } } },
    },
  };
  return Response.json(spec, { headers: { "Cache-Control": "public, max-age=300", "X-API-Version": API_VERSION } });
}
