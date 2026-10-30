/**
 * The Housy logo, defined once. The mark is a lower-case "h" whose shoulder is a gabled roof, with one lit amber doorway: the
 * first letter of the name and a house in a single line. Beside it sits the wordmark "housy", set in Inter Display SemiBold
 * and stored here as outlines so it looks the same in every browser, share picture and email. Everything that draws the
 * logo reads these shapes; docs/BRAND.md says how to use it, and scripts/make-brand-icons.ts redraws the icon files.
 */
export const BRAND = {
  amber: "#FBB017",
  /** The doorway: a deeper amber that holds up on white and on ink. */
  door: "#F2A007",
  ink: "#1F2125",
  grey: "#C9CDD3",
  paper: "#FAF8F4",
  tagline: "Find property you can trust.",
  /** The mark on a 64 x 64 grid: one stroke (stem, roof, wall) and the doorway. */
  mark: { path: "M14 6V58M14 33 33 17 50 31V58", stroke: 9, door: { x: 29, y: 42, w: 8, h: 16 } },
  /** The full logo: the mark, then the wordmark on the mark's baseline. viewBox 0 0 261 73; the mark is the first 64 units. */
  lockup: { width: 261, height: 73, wordmarkTransform: "translate(74.091 58) scale(0.034899)" },
  wordmark: "M364 -597C364 -777 463 -856 595 -856C730 -856 808 -775 808 -620V0H1061V-660C1061 -931 905 -1077 684 -1077C542 -1077 436 -1016 364 -901V-1490H112V0H364ZM1683.3 24C1994.3 24 2204.3 -199 2204.3 -527C2204.3 -855 1994.3 -1080 1683.3 -1080C1372.3 -1080 1162.3 -855 1162.3 -527C1162.3 -199 1372.3 24 1683.3 24ZM1683.3 -187C1520.3 -187 1417.3 -316 1417.3 -527C1417.3 -739 1521.3 -869 1683.3 -869C1844.3 -869 1948.3 -738 1948.3 -527C1948.3 -317 1845.3 -187 1683.3 -187ZM2680.5 21C2826.5 21 2933.5 -43 3005.5 -162V0H3253.5V-1056H3000.5V-459C3000.5 -279 2902.5 -200 2769.5 -200C2634.5 -200 2556.5 -281 2556.5 -436V-1056H2304.5V-396C2304.5 -125 2459.5 21 2680.5 21ZM3817.8 25C4078.8 25 4265.8 -105 4265.8 -311C4265.8 -466 4168.8 -558 3959.8 -602L3769.8 -641C3681.8 -660 3629.8 -699 3629.8 -762C3629.8 -834 3697.8 -890 3808.8 -890C3923.8 -890 4000.8 -821 4002.8 -727H4239.8C4233.8 -944 4058.8 -1079 3802.8 -1079C3544.8 -1079 3377.8 -948 3377.8 -754C3377.8 -594 3483.8 -491 3685.8 -449L3865.8 -412C3954.8 -393 4009.8 -356 4009.8 -292C4009.8 -217 3935.8 -164 3813.8 -164C3687.8 -164 3613.8 -223 3602.8 -326H3353.8C3369.8 -99 3560.8 25 3817.8 25ZM4383.1 418H4548.1C4701.1 418 4805.1 339 4868.1 174L5340.1 -1056H5076.1L4883.1 -506C4856.1 -428 4831.1 -350 4807.1 -272C4783.1 -350 4757.1 -428 4731.1 -506L4537.1 -1056H4270.1L4677.1 -6L4638.1 96C4608.1 179 4576.1 213 4508.1 213H4383.1Z",
} as const;

type Svg = { size?: number; tile?: boolean; square?: boolean; scale?: number; color?: string };

/** The mark as an SVG document, for icon files. tile: on an ink rounded tile; square: full-bleed ink (phones round it). */
export function markSvg({ size = 64, tile = true, square = false, scale = 0.74, color }: Svg = {}) {
  const m = BRAND.mark, line = color ?? (tile || square ? "#FFFFFF" : BRAND.ink);
  const shape = `<path d="${m.path}" fill="none" stroke="${line}" stroke-width="${m.stroke}" stroke-linejoin="miter" stroke-miterlimit="10"/><rect x="${m.door.x}" y="${m.door.y}" width="${m.door.w}" height="${m.door.h}" fill="${BRAND.door}"/>`;
  const bg = square ? `<rect width="64" height="64" fill="${BRAND.ink}"/>` : tile ? `<rect width="64" height="64" rx="14" fill="${BRAND.ink}"/>` : "";
  const body = bg ? `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${shape}</g>` : shape;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${bg}${body}</svg>`;
}

/** The full logo (mark and wordmark) as an SVG document, height in pixels. */
export function lockupSvg({ height = 73, color = BRAND.ink }: { height?: number; color?: string } = {}) {
  const m = BRAND.mark, l = BRAND.lockup;
  const width = Math.round((height * l.width) / l.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${l.width} ${l.height}"><path d="${m.path}" fill="none" stroke="${color}" stroke-width="${m.stroke}" stroke-linejoin="miter" stroke-miterlimit="10"/><rect x="${m.door.x}" y="${m.door.y}" width="${m.door.w}" height="${m.door.h}" fill="${BRAND.door}"/><path transform="${l.wordmarkTransform}" fill="${color}" d="${BRAND.wordmark}"/></svg>`;
}
