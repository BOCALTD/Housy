"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One confirmation window for the whole app. Anything that removes, deletes, ends or switches something asks first:
 *
 *  - In any page, server or client: put data-confirm on the button (or on the form) with the question, and optionally
 *    data-confirm-body (what will happen), data-confirm-ok (the button's words) and data-confirm-tone="default" for
 *    something that is not destructive. Nothing else is needed: the host below catches the tap, asks, and lets it through.
 *  - In client code: const ok = await confirmAction({ title, body, ok }).
 *
 * Without scripts the button still works, as it always did.
 */
export type ConfirmOptions = { title: string; body?: string; ok?: string; cancel?: string; tone?: "danger" | "default" };

let open: ((o: ConfirmOptions) => Promise<boolean>) | null = null;

/** Ask for confirmation. Resolves true when the person confirms; false when they cancel, press Escape or tap outside. */
export function confirmAction(o: ConfirmOptions): Promise<boolean> {
  return open ? open(o) : Promise.resolve(window.confirm(o.body ? `${o.title}\n\n${o.body}` : o.title));
}
export const useConfirm = () => confirmAction;

const optionsFrom = (el: HTMLElement): ConfirmOptions => ({
  title: el.dataset.confirm || "Are you sure?",
  body: el.dataset.confirmBody || undefined,
  ok: el.dataset.confirmOk || undefined,
  cancel: el.dataset.confirmCancel || undefined,
  tone: el.dataset.confirmTone === "default" ? "default" : "danger",
});

export function ConfirmHost() {
  const box = useRef<HTMLDialogElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const settle = useRef<((v: boolean) => void) | null>(null);

  useEffect(() => {
    open = (o) => new Promise<boolean>((resolve) => {
      settle.current?.(false);
      settle.current = resolve;
      setOpts(o);
    });
    // Taps on anything marked data-confirm are held until the person answers; then the same tap goes through.
    const pass = new WeakSet<Element>();
    const click = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-confirm]");
      if (!el || el.tagName === "FORM" || pass.has(el) || (el as HTMLButtonElement).disabled) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      void confirmAction(optionsFrom(el)).then((ok) => {
        if (!ok) return;
        pass.add(el);
        try { el.click(); } finally { pass.delete(el); }
      });
    };
    const submit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!form?.matches?.("form[data-confirm]") || pass.has(form)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const by = e.submitter as HTMLElement | null;
      void confirmAction(optionsFrom(form)).then((ok) => {
        if (!ok) return;
        pass.add(form);
        try { form.requestSubmit(by && by.matches("button, input[type=submit]") ? by : undefined); } finally { pass.delete(form); }
      });
    };
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    return () => { open = null; document.removeEventListener("click", click, true); document.removeEventListener("submit", submit, true); };
  }, []);

  useEffect(() => {
    const d = box.current;
    if (!d) return;
    if (opts && !d.open) { d.showModal(); requestAnimationFrame(() => (opts.tone === "default" ? okBtn.current : d.querySelector<HTMLButtonElement>(".cfm-cancel"))?.focus()); }
    if (!opts && d.open) d.close();
  }, [opts]);

  const answer = (v: boolean) => { const s = settle.current; settle.current = null; setOpts(null); s?.(v); };
  const danger = opts?.tone !== "default";

  return (
    <dialog ref={box} className={`cfm${danger ? " cfm-danger" : ""}`} aria-labelledby="cfm-title" aria-describedby={opts?.body ? "cfm-body" : undefined}
      onCancel={(e) => { e.preventDefault(); answer(false); }}
      onClick={(e) => { if (e.target === box.current) answer(false); }}>
      {opts ? (
        <div className="cfm-inner">
          <span className="cfm-icon" aria-hidden="true">
            {danger
              ? <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
              : <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>}
          </span>
          <h2 id="cfm-title">{opts.title}</h2>
          {opts.body ? <p id="cfm-body">{opts.body}</p> : null}
          <div className="cfm-actions">
            <button type="button" className="btn cfm-cancel" onClick={() => answer(false)}>{opts.cancel ?? "Cancel"}</button>
            <button type="button" ref={okBtn} className={`btn ${danger ? "danger-solid" : "primary"} cfm-ok`} onClick={() => answer(true)}>{opts.ok ?? (danger ? "Yes, remove it" : "Continue")}</button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
