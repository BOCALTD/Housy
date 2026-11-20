import { runtimeEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

/** Settings the browser needs (map tiles and the Google client ID), as set in Admin, Connections. Nothing secret. */
export async function GET() {
  const e = await runtimeEnv();
  const pick = (k: string) => e[k]?.trim() || undefined;
  return Response.json({
    map: { NEXT_PUBLIC_MAP_TILES: pick("NEXT_PUBLIC_MAP_TILES"), NEXT_PUBLIC_MAP_ATTRIBUTION: pick("NEXT_PUBLIC_MAP_ATTRIBUTION"), NEXT_PUBLIC_MAP_SATELLITE_TILES: pick("NEXT_PUBLIC_MAP_SATELLITE_TILES"), NEXT_PUBLIC_MAP_SATELLITE_TILE_SIZE: pick("NEXT_PUBLIC_MAP_SATELLITE_TILE_SIZE"), NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION: pick("NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION") },
    googleClientId: pick("NEXT_PUBLIC_GOOGLE_CLIENT_ID") ?? "",
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
