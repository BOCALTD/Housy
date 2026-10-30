/**
 * The Housy logo, defined once. The mark is an "H" standing under a roof on an amber tile: a house, and the first letter of
 * the name. Every place that draws the logo (header, footer, sign-in, loader, welcome slides, browser icon, app icons and the
 * link-preview pictures) reads these shapes, so the logo can only change here. docs/BRAND.md says how to use it.
 */
export const BRAND = {
  amber: "#FBB017",
  amberDeep: "#F29F05",
  ink: "#1F2125",
  grey: "#C9CDD3",
  /** 64 x 64 drawing. */
  tileRadius: 15,
  roof: "M11 31 32 13l21 18",
  body: "M21 30v21M43 30v21M21 39h22",
  stroke: 5.5,
  /** Thicker lines for very small sizes (browser tab icon), so the mark stays sharp at 16 pixels. */
  strokeSmall: 6.5,
  tagline: "Find property you can trust.",
} as const;

/** The logo as an SVG document, for files written to disk (icon.svg) and for scripts that draw the app icons. */
export function markSvg({ size = 64, stroke = BRAND.stroke, tile = true, padding = 0 }: { size?: number; stroke?: number; tile?: boolean; padding?: number } = {}) {
  const inner = 64 - padding * 2;
  const scale = inner / 64;
  const lines = `<g transform="translate(${padding} ${padding}) scale(${scale})" fill="none" stroke="${BRAND.ink}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${BRAND.roof}"/><path d="${BRAND.body}"/></g>`;
  const bg = tile ? `<rect width="64" height="64" rx="${BRAND.tileRadius}" fill="${BRAND.amber}"/>` : `<rect width="64" height="64" fill="${BRAND.amber}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${bg}${lines}</svg>`;
}
