import { BRAND } from "@/lib/brand";
import { PLATFORM_NAME } from "@/lib/labels";

const M = BRAND.mark;
const ink = (tone: "ink" | "light") => (tone === "light" ? "#FFFFFF" : "var(--logo-ink, #1F2125)");

function MarkShapes({ line }: { line: string }) {
  return (
    <>
      <path d={M.path} fill="none" stroke={line} strokeWidth={M.stroke} strokeLinejoin="miter" strokeMiterlimit={10} />
      <rect className="logo-door" x={M.door.x} y={M.door.y} width={M.door.w} height={M.door.h} fill={BRAND.door} />
    </>
  );
}

/**
 * The mark on its own: a lower-case "h" with a gabled roof and a lit doorway. tile puts it on the ink app tile (icons,
 * avatars, small badges). Decorative: the name beside it, or the link's label, carries the meaning.
 */
export function LogoMark({ size = 48, tone = "ink", tile = false, className }: { size?: number; tone?: "ink" | "light"; tile?: boolean; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {tile ? (
        <>
          <rect width="64" height="64" rx="14" fill={BRAND.ink} />
          <g transform="translate(32 32) scale(.74) translate(-32 -32)"><MarkShapes line="#FFFFFF" /></g>
        </>
      ) : <MarkShapes line={ink(tone)} />}
    </svg>
  );
}

/** The full logo, mark and wordmark, drawn from outlines so it is identical everywhere. height is in pixels. */
export function Logo({ height = 30, tone = "ink" }: { height?: number; tone?: "ink" | "light" }) {
  const l = BRAND.lockup;
  return (
    <svg className="logo" width={Math.round((height * l.width) / l.height)} height={height} viewBox={`0 0 ${l.width} ${l.height}`} role="img" aria-label={PLATFORM_NAME} focusable="false">
      <MarkShapes line={ink(tone)} />
      <path transform={l.wordmarkTransform} fill={ink(tone)} d={BRAND.wordmark} />
    </svg>
  );
}

/** The loading indicator: the mark, gently pulsing (still when the person has asked for less motion). */
export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <LogoMark size={64} tile />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
