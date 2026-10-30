"use client";

import { useEffect, useRef } from "react";

/**
 * A sign-in box the browser cannot pre-fill. It is read-only until someone touches it (browsers skip read-only boxes when
 * filling saved logins), and anything a browser still slips in before the person starts is cleared. People can still type,
 * or pick from their password manager on purpose once the box has focus.
 */
export function useNoPrefill<T extends HTMLInputElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let touched = false;
    const unlock = () => { touched = true; el.readOnly = false; };
    el.addEventListener("focus", unlock);
    el.addEventListener("pointerdown", unlock);
    const clear = () => { if (!touched && el.value) el.value = ""; };
    const timers = [60, 400, 1200].map((ms) => setTimeout(clear, ms));
    return () => { timers.forEach(clearTimeout); el.removeEventListener("focus", unlock); el.removeEventListener("pointerdown", unlock); };
  }, []);
  return ref;
}

export function CleanInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useNoPrefill<HTMLInputElement>();
  return <input {...props} ref={ref} readOnly autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-1p-ignore="" data-form-type="other" />;
}
