"use client";

import { useFormStatus } from "react-dom";

/** Inside a sign-in form: while it is being sent, the screen says what is happening instead of sitting still. */
export function PendingOverlay({ text }: { text: string }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="switch-veil" role="status" aria-live="polite">
      <div className="cfm-inner"><ol className="switch-steps"><li className="now"><span className="switch-dot" aria-hidden="true" />{text}</li></ol></div>
    </div>
  );
}
