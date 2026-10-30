import { BRAND } from "@/lib/brand";
import { PLATFORM_NAME } from "@/lib/labels";

/** The mark on its own: an "H" under a roof on an amber tile. Decorative; the name beside it carries the meaning. */
export function LogoMark({ size = 48, className }: { size?: number; className?: string }) {
  const stroke = size <= 24 ? BRAND.strokeSmall : BRAND.stroke;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx={BRAND.tileRadius} fill={BRAND.amber} />
      <g fill="none" stroke={BRAND.ink} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
        <path d={BRAND.roof} />
        <path d={BRAND.body} />
      </g>
    </svg>
  );
}

/** The full logo: mark and wordmark. The wordmark is set in lower case ("housy"); in sentences the name is written "Housy". */
export function Logo({ size = 32, tone = "ink" }: { size?: number; tone?: "ink" | "light" }) {
  return (
    <span className={`logo logo-${tone}`} style={{ ["--logo" as string]: `${size}px` }}>
      <LogoMark size={size} className="logo-mark" />
      <span className="wordmark">{PLATFORM_NAME}</span>
    </span>
  );
}

/** The loading indicator: the mark, gently pulsing (still when the person has asked for less motion). */
export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <LogoMark size={64} />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
