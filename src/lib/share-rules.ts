/**
 * Sharing a property, reel, agent or company outside the app: the words that go with the link, the links for each social
 * network, and the checks on where a shared link may lead back to. Pure functions, so they can be tested without a browser.
 */

export type ShareKind = "property" | "reel" | "agent" | "company";

/** The pages a shared link may lead back to. Anything else falls back to the home page. */
const SHARE_PATHS = [/^\/properties\/PROP-[A-Z0-9]{4,20}$/, /^\/reels\/[0-9a-f-]{36}$/, /^\/agents\/[0-9a-f-]{36}$/, /^\/companies\/[0-9a-f-]{36}$/];

export function shareablePath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  return SHARE_PATHS.some((r) => r.test(path)) ? path : null;
}

/** Where a person who opened a shared link lands: the page itself, marked as shared so it can greet them. */
export function landingPath(path: string): string {
  return `${path}?shared=1`;
}

/**
 * The link to share. A signed-in person's link carries their invite code, so someone who joins through it is counted as their
 * referral; it goes through /r/CODE, which remembers the code and then opens the page. Without a code the page is linked directly.
 */
export function shareLink(origin: string, path: string, code: string | null): string {
  const base = origin.replace(/\/+$/, "");
  return code ? `${base}/r/${code}?to=${encodeURIComponent(path)}` : `${base}${landingPath(path)}`;
}

export interface ShareFacts {
  title: string;
  price?: string;
  place?: string;
  details?: string[];
  by?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The words posted with the link: what it is, the key facts, and an invitation to see more. Kept short for X and SMS. */
export function shareText(kind: ShareKind, f: ShareFacts, platform: string): string {
  const lines: string[] = [];
  const head = { property: "🏠", reel: "🎬", agent: "👤", company: "🏢" }[kind];
  lines.push(`${head} ${clip(f.title.trim(), 90)}`);
  const facts = [f.price, f.place].filter((x): x is string => !!x && !!x.trim());
  if (facts.length) lines.push(facts.join(" · "));
  const more = (f.details ?? []).filter(Boolean).slice(0, 3);
  if (more.length) lines.push(more.join(" · "));
  if (f.by) lines.push(kind === "agent" || kind === "company" ? f.by : `Listed by ${f.by}`);
  const invite = {
    property: `See all the photos and details, and contact them safely on ${platform}. Sign up free to see more.`,
    reel: `Watch it on ${platform}. Sign up free to see more homes like this.`,
    agent: `See their reviews and listings on ${platform}. Sign up free to message them.`,
    company: `See their properties and reviews on ${platform}. Sign up free to see more.`,
  }[kind];
  lines.push(invite);
  return lines.join("\n");
}

export type Network = "whatsapp" | "facebook" | "x" | "linkedin" | "telegram" | "email" | "sms";

/** A link that opens each network's own share screen with the words and link filled in. */
export function networkLink(network: Network, url: string, text: string, subject: string): string {
  const e = encodeURIComponent;
  switch (network) {
    case "whatsapp": return `https://wa.me/?text=${e(`${text}\n${url}`)}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
    case "x": return `https://twitter.com/intent/tweet?text=${e(clip(text.split("\n").slice(0, 2).join(" · "), 200))}&url=${e(url)}`;
    case "linkedin": return `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`;
    case "telegram": return `https://t.me/share/url?url=${e(url)}&text=${e(text)}`;
    case "email": return `mailto:?subject=${e(subject)}&body=${e(`${text}\n\n${url}`)}`;
    case "sms": return `sms:?&body=${e(`${text.split("\n")[0]}\n${url}`)}`;
  }
}

export const NETWORKS: { key: Network; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "facebook", label: "Facebook" },
  { key: "x", label: "X (Twitter)" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "telegram", label: "Telegram" },
  { key: "email", label: "Email" },
  { key: "sms", label: "Text message" },
];

/** How many photos a signed-out visitor sees before being asked to sign up. */
export const GUEST_PHOTOS = 3;
/** How many reviews a signed-out visitor sees on an agent or company profile. */
export const GUEST_REVIEWS = 3;
