"use client";

import { useState } from "react";

const Eye = ({ off }: { off: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
    {off ? <path d="M3 3l18 18" /> : null}
  </svg>
);

/** A password box with a button to show or hide what was typed. */
export function PasswordInput({ name, id, autoComplete, minLength, required = true, value, onChange, describedBy, invalid }: {
  name: string; id: string; autoComplete: string; minLength?: number; required?: boolean;
  value?: string; onChange?: (v: string) => void; describedBy?: string; invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw">
      <input
        name={name} id={id} type={show ? "text" : "password"} required={required} minLength={minLength} autoComplete={autoComplete}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-describedby={describedBy} aria-invalid={invalid || undefined}
        {...(onChange ? { value: value ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) } : {})}
        // Password managers that honour these do not offer to fill or save the sign-in.
        data-lpignore={autoComplete === "off" ? "true" : undefined} data-1p-ignore={autoComplete === "off" ? "" : undefined}
      />
      <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"} aria-controls={id}>
        <Eye off={show} />
      </button>
    </span>
  );
}

const score = (p: string) => {
  let n = 0;
  if (p.length >= 10) n += 1;
  if (p.length >= 14) n += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n += 1;
  if (/\d/.test(p)) n += 1;
  if (/[^A-Za-z0-9]/.test(p)) n += 1;
  return Math.min(4, n);
};
const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

/** Choose a password: the password, how strong it is, and the same again to confirm, checked as you type. */
export function NewPassword({ minLength = 10, label = "Password" }: { minLength?: number; label?: string }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const s = a.length < minLength ? 0 : score(a);
  const mismatch = b.length > 0 && a !== b;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="field" htmlFor="password">{label}
        <PasswordInput name="password" id="password" autoComplete="new-password" minLength={minLength} value={a} onChange={setA} describedBy="pw-strength" />
        <span className="pw-meter" data-score={a ? s : undefined} aria-hidden="true"><i /><i /><i /><i /></span>
        <small id="pw-strength" aria-live="polite">{a ? `${LABELS[s]}. ` : ""}At least {minLength} characters. Longer is stronger; a short phrase works well.</small>
      </label>
      <label className="field" htmlFor="passwordConfirm">Confirm password
        <PasswordInput name="passwordConfirm" id="passwordConfirm" autoComplete="new-password" minLength={minLength} value={b} onChange={setB} describedBy="pw-match" invalid={mismatch} />
        <small id="pw-match" aria-live="polite" className={mismatch ? "pw-bad" : b && a === b ? "pw-good" : undefined}>{mismatch ? "The passwords do not match yet." : b && a === b ? "The passwords match." : "Type the same password again."}</small>
      </label>
    </div>
  );
}
