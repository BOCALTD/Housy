/**
 * Signs that a listing waiting for review needs a closer look (master prompt §37, platform administration): an asking price far
 * from similar homes, contact details that route buyers off the platform, requests for money before an inspection, photos or
 * wording already used by another company, and very new companies. These are prompts for the reviewer, never decisions:
 * the administrator approves or returns every listing. Pure functions, tested on their own.
 */
import type { Stat } from "./market-rules";

export type RiskFlag = { code: string; level: "high" | "medium"; text: string };

const PHONE = /(?:\+?234[\s-]?|\b0)[789][01]\d(?:[\s-]?\d){7}\b/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const OFF_PLATFORM = /\b(?:whats\s?app|call\s+(?:me|us)\s+on|text\s+(?:me|us)\s+on|dm\s+(?:me|us))\b/i;
const MONEY_FIRST = [
  /\bpay\w*\s+(?:a\s+|the\s+)?(?:\w+\s+)?(?:before|to\s+book|to\s+secure|to\s+reserve)\s+(?:the\s+)?(?:inspection|viewing|visit|it)\b/i,
  /\binspection\s+(?:fee|charge|money)\b/i,
  /\b(?:viewing|form)\s+fee\b/i,
  /\bsend\s+(?:the\s+)?(?:money|payment|deposit)\b/i,
  /\b(?:western\s+union|moneygram|gift\s*cards?|bitcoin|usdt|crypto)\b/i,
  /\b(?:first\s+come,?\s+first\s+served|pay\s+now\s+to\s+avoid)\b/i,
];

/** Contact details or invitations to talk off the platform. */
export function contactInText(text: string): boolean {
  return PHONE.test(text) || EMAIL.test(text) || OFF_PLATFORM.test(text);
}

/** Asking for money before anyone has seen the property, the most common rental scam. */
export function moneyBeforeViewing(text: string): boolean {
  return MONEY_FIRST.some((r) => r.test(text));
}

/** Far below similar homes is a common sign of a fake listing; far above is usually a typing mistake (an extra zero). */
export function priceFlag(value: number, s: Stat | null, what: string): RiskFlag | null {
  if (!s || s.median <= 0) return null;
  const ratio = value / s.median;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (ratio < 0.4) return { code: "PRICE_LOW", level: "high", text: `Asking ${pct(ratio)} of the typical figure for ${what} (from ${s.n} listings). Very low prices are a common sign of a fake listing.` };
  if (ratio > 3) return { code: "PRICE_HIGH", level: "medium", text: `Asking ${pct(ratio)} of the typical figure for ${what}. Check the price for an extra zero or the wrong period.` };
  return null;
}

/** Everything that can be read from the listing itself. */
export function textFlags(l: { title: string; description: string; feesNote: string }): RiskFlag[] {
  const all = `${l.title}\n${l.description}\n${l.feesNote}`;
  const out: RiskFlag[] = [];
  if (moneyBeforeViewing(all)) out.push({ code: "MONEY_FIRST", level: "high", text: "Asks for money before an inspection or to reserve the property." });
  if (contactInText(all)) out.push({ code: "CONTACT", level: "medium", text: "Contact details or a request to talk outside the platform in the text. Enquiries should come through the platform." });
  return out;
}

/** The text compared for copied descriptions: lower case, single spaces, long enough to mean something. */
export function descriptionKey(d: string): string | null {
  const t = d.toLowerCase().replace(/\s+/g, " ").trim();
  return t.length >= 80 ? t : null;
}

export const LEVEL_ORDER = { high: 0, medium: 1 } as const;
export const sortFlags = (f: RiskFlag[]) => [...f].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
