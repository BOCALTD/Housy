import { humanize, tone } from "@/lib/labels";

export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${tone(status)}`}>{label ?? humanize(status)}</span>;
}

/** Shows ?error= and ?notice= messages set by server actions. */
export function Flash({ searchParams }: { searchParams?: { error?: string; notice?: string } }) {
  if (searchParams?.error) return <div className="flash error" role="alert">{searchParams.error}</div>;
  if (searchParams?.notice) return <div className="flash notice" role="status">{searchParams.notice}</div>;
  return null;
}

export function HouseIcon() {
  return (
    <svg viewBox="0 0 120 80" fill="none" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 40 60 8l50 32M20 36v36h80V36M48 72V48h24v24" />
    </svg>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function EnumOptions({ values }: { values: readonly string[] }) {
  return <>{values.map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</>;
}

export type SP = { [key: string]: string | string[] | undefined };

export function sp(searchParams: SP | undefined, key: string): string | undefined {
  const v = searchParams?.[key];
  return Array.isArray(v) ? v[0] : v;
}
