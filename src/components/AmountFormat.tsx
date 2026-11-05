"use client";

import { useEffect } from "react";

const MONEY = /₦|naira|price|amount|budget|rent|fee|cost|value|salary|deposit|charge|commission|fund|pay|income|limit|kobo|valuation|offer|sum/i;
const NOT_MONEY = /lat|lng|long|percent|%|rate|ratio|area|size|sqm|m²|year|month|day|hour|minute|bed|bath|toilet|floor|unit count|position|order|score|age|zoom|radius|km|weeks?/i;

function labelOf(el: HTMLInputElement) {
  const l = el.closest("label")?.textContent ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "") ?? "";
  return `${l} ${el.name} ${el.getAttribute("aria-label") ?? ""} ${el.placeholder}`;
}
function isMoney(el: EventTarget | null): el is HTMLInputElement {
  // Plain text boxes that a form sends, by name. Live calculators (no name, no form) keep their own numbers.
  if (!(el instanceof HTMLInputElement) || el.type !== "text" || !el.name || !el.form) return false;
  if (el.inputMode !== "decimal" && el.inputMode !== "numeric") return false;
  if (el.dataset.amount === "off") return false;
  if (el.dataset.amount === "1") return true;
  const t = labelOf(el);
  const yes = MONEY.test(t) && !NOT_MONEY.test(t);
  if (yes) el.dataset.amount = "1";
  return yes;
}
/** "25000000.5" -> "25,000,000.5"; leaves anything that is not a plain number alone. */
export function groupDigits(v: string) {
  const raw = v.replace(/,/g, "");
  const m = /^(₦?\s?)(\d+)(\.\d{0,2})?$/.exec(raw);
  if (!m) return v;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (m[3] ?? "");
}

/**
 * Money boxes show thousands separators while you type (25,000,000), the way people read naira, and the separators are taken
 * out again as the form is sent, so the server always receives plain digits. Applies to boxes labelled as money only.
 */
export function AmountFormat() {
  useEffect(() => {
    const fmt = (el: HTMLInputElement) => {
      const before = el.value, caret = el.selectionStart ?? before.length;
      const digitsLeft = before.slice(0, caret).replace(/[^\d.]/g, "").length;
      const after = groupDigits(before);
      if (after === before) return;
      el.value = after;
      if (document.activeElement === el) {
        let n = 0, pos = 0;
        while (pos < after.length && n < digitsLeft) { if (/[\d.]/.test(after[pos])) n++; pos++; }
        el.setSelectionRange(pos, pos);
      }
    };
    const onInput = (e: Event) => { if (isMoney(e.target)) fmt(e.target); };
    const sweep = () => document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"], input[inputmode="numeric"]').forEach((el) => { if (isMoney(el) && el !== document.activeElement) fmt(el); });
    const onFormData = (e: Event) => {
      const fd = (e as FormDataEvent).formData; const form = e.target as HTMLFormElement;
      form.querySelectorAll<HTMLInputElement>('input[data-amount="1"]').forEach((el) => { if (el.name && fd.has(el.name)) fd.set(el.name, el.value.replace(/,/g, "")); });
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("formdata", onFormData, true);
    sweep();
    let queued = false;
    const mo = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sweep(); }); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { document.removeEventListener("input", onInput, true); document.removeEventListener("formdata", onFormData, true); mo.disconnect(); };
  }, []);
  return null;
}
