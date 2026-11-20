// The browser's copy of the public settings (map tiles, Google client ID) from /api/public-config, fetched once per page load.
export type PublicConfig = { map: Record<string, string | undefined>; googleClientId: string };
let cached: Promise<PublicConfig> | null = null;
export function publicConfig(): Promise<PublicConfig> {
  cached ??= fetch("/api/public-config", { cache: "default" }).then((r) => (r.ok ? r.json() : null)).then((j) => j ?? { map: {}, googleClientId: "" }).catch(() => ({ map: {}, googleClientId: "" }));
  return cached;
}
