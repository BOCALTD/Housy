"use client";

/** Opens the browser's print dialog for the current page. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return <button type="button" className="btn primary" onClick={() => window.print()}>{label}</button>;
}
