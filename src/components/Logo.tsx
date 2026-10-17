/** Placeholder brand mark (a house on a navy tile). Replace the shapes here, in src/app/icon.svg and in src/app/apple-icon.png when the real logo exists. */
export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#14284B" />
      <path d="M12 31 32 14l20 17" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 29v21h28V29" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="27" y="36" width="10" height="14" rx="2" fill="#C9A24A" />
    </svg>
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
