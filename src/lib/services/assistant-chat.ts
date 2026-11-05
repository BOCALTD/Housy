import { KNOWLEDGE, retrieve, type Passage } from "../assistant-knowledge";
import { formatKobo } from "../money";
import { priceSuffix } from "../listing-rules";
import { runAi } from "./ai";
import { askPortfolio } from "./ai-assist";
import { smartSearch } from "./ai-search";
import { can } from "../permissions";
import type { Ctx } from "./context";

/**
 * The Housy assistant as a conversation, the way Claude works: it keeps the thread, looks things up (homes for a property
 * question, the company's records for a workspace question, Housy's own help for everything else), then answers in its own
 * words with the results attached as cards or a table. With an AI service connected Claude writes the answer from what was
 * looked up; without one, the built-in rules answer from the same results. It never invents a listing, price or figure.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatCard = { ref: string; title: string; place: string; price: string; beds: string; why: string[] };
export type ChatTable = { title: string; columns: string[]; rows: string[][]; note: string };
export type ChatAnswer = { text: string; cards: ChatCard[]; table: ChatTable | null; links: [string, string][]; source: "AI" | "RULES"; notice: string };
export type Who = { userId?: string | null; companyId?: string | null; visitorKey: string; name?: string | null; member?: Ctx | null };

const PROPERTY = /\b(\d+\s*-?\s*bed(room)?s?|flat|house|houses|home|homes|duplex|terrace|bungalow|land|plot|shop|office|warehouse|apartment|self[\s-]?contain(ed)?|mini[\s-]?flat|studio|short[\s-]?let|to rent|for rent|for sale|to buy|lease|property|properties)\b/i;
const PORTFOLIO = /\b(overdue|arrears|owing|debtors?|leases?|tenants?|tenancy|maintenance|work orders?|repairs?|vacan(t|cy|cies)|occupan(cy|t)|rent roll|expir(y|ing|es)|service charges?|collect(ed|ion)|my portfolio|our portfolio|my properties|our properties)\b/i;
const GREETING = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|howdy|yo|sup|hiya)\b[\s!.]*$/i;
const THANKS = /^\s*(thanks|thank you|thx|ok(ay)?|great|cool|nice)\b[\s!.]*$/i;

function cardsFrom(found: Awaited<ReturnType<typeof smartSearch>>["found"]): ChatCard[] {
  return found.slice(0, 4).map((f) => ({
    ref: f.listing.publicRef, title: f.listing.title, place: [f.listing.city, f.listing.state].filter(Boolean).join(", "),
    price: `${formatKobo(f.listing.priceKobo)}${priceSuffix(f.listing.pricePeriod)}`, beds: f.listing.bedrooms ? `${f.listing.bedrooms} bed` : "",
    why: f.reasons.slice(0, 2),
  }));
}

/** Look things up for the latest question. */
async function lookUp(who: Who, question: string) {
  const kb = retrieve(question);
  const workspace = who.member && can(who.member.role, "ai.use") ? who.member : null;
  let table: ChatTable | null = null, cards: ChatCard[] = [], searchNote = "", searched = false;
  if (workspace && PORTFOLIO.test(question)) {
    const a = await askPortfolio(workspace, question).catch(() => null);
    if (a && a.allowed) table = { title: a.title, columns: a.columns, rows: a.rows.slice(0, 25), note: a.summary };
  } else if (PROPERTY.test(question)) {
    searched = true;
    const r = await smartSearch(question, who.visitorKey).catch(() => null);
    if (r) {
      cards = cardsFrom(r.found);
      searchNote = r.nothingUnderstood ? "The search could not tell what kind of property was wanted." : `${r.found.length} listing${r.found.length === 1 ? "" : "s"} matched${r.found.filter((f) => f.exact).length ? ` (${r.found.filter((f) => f.exact).length} exactly)` : ""}.`;
    }
  }
  return { kb, table, cards, searchNote, searched };
}

function rulesAnswer(who: Who, question: string, found: Awaited<ReturnType<typeof lookUp>>): string {
  const first = who.name ? who.name.split(/\s+/)[0] : "";
  if (GREETING.test(question)) return `Hello${first ? ` ${first}` : ""}! 👋 I'm the Housy assistant. I can find homes for you, explain how inspections, verification and flatmate matching work${who.member ? ", and answer questions about your company's rent, leases and maintenance" : ""}. What would you like to do?`;
  if (THANKS.test(question)) return "You're welcome! Is there anything else I can help you find?";
  if (found.table) return `**${found.table.title}**\n\n${found.table.note}`;
  if (found.searched) {
    if (found.cards.length) return `Here ${found.cards.length === 1 ? "is a home" : `are ${found.cards.length} homes`} that fit what you asked. ${found.searchNote}\n\n- Tap one to see photos, the reel and the map\n- Book an inspection from the property page\n- Remember: **never pay before you inspect**`;
    return `I couldn't find a listing that fits that yet. ${found.searchNote}\n\nYou could:\n- widen the budget or the area\n- try a nearby city or a different number of bedrooms\n- **save the search** on Find property, and Housy will tell you when a match is listed`;
  }
  if (found.kb.length) return found.kb[0].text;
  return `I can help with:\n- **finding property**: try "3-bedroom flat to rent in Yaba under ₦3m"\n- **how Housy works**: inspections, verification, flatmates, artisans, listing a property\n${who.member ? "- **your company**: overdue rent, leases ending soon, open maintenance\n" : ""}\nWhat would you like to know?`;
}

const SYSTEM = (who: Who, ctx: string) => `You are the Housy assistant, inside Housy, a Nigeria-first property marketplace and property management platform.
Speak like a warm, sharp Nigerian property expert: clear, concise, friendly, never pushy. Use Nigerian English and naira (₦).
${who.name ? `You are talking to ${who.name.split(/\s+/)[0]}.` : "You are talking to a visitor."}${who.member ? " They are signed in to their company workspace." : ""}

Rules:
- Use ONLY the facts in CONTEXT and in the conversation. If CONTEXT does not hold the answer, say you are not sure and suggest the right Housy page or Contact and support. Never invent listings, prices, people, figures, laws or policies.
- Listings found are shown to the user as cards under your reply: refer to them ("the first one in Lekki") but do not repeat every detail or write URLs.
- A report table, if any, is shown under your reply: summarise what matters in two or three sentences.
- Safety always: never suggest paying before inspecting, and recommend paying company accounts with a receipt.
- No legal, tax or investment advice; say a professional should confirm.
- Format: short paragraphs, bullet lists when listing options, **bold** for the key fact. Usually under 140 words. No headings. Ask one short follow-up question when it helps.

CONTEXT:
${ctx}`;

function contextFor(found: Awaited<ReturnType<typeof lookUp>>): string {
  const parts: string[] = [];
  if (found.kb.length) parts.push("Housy help:\n" + found.kb.map((p: Passage) => `- ${p.title}: ${p.text}`).join("\n"));
  if (found.searched) parts.push(`Property search: ${found.searchNote}\n` + (found.cards.length ? found.cards.map((c, i) => `${i + 1}. ${c.title}, ${c.place}, ${c.price}${c.beds ? `, ${c.beds}` : ""}${c.why.length ? ` (matches: ${c.why.join("; ")})` : ""}`).join("\n") : "No listings matched."));
  if (found.table) parts.push(`Company report "${found.table.title}": ${found.table.note}\nColumns: ${found.table.columns.join(" | ")}\n` + found.table.rows.slice(0, 15).map((r) => r.join(" | ")).join("\n"));
  if (!parts.length) parts.push("Housy help (general):\n" + KNOWLEDGE.slice(0, 4).map((p) => `- ${p.title}: ${p.text}`).join("\n"));
  return parts.join("\n\n");
}

export async function assistantReply(who: Who, history: ChatTurn[]): Promise<ChatAnswer> {
  const turns = history.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-12).map((t) => ({ role: t.role, content: t.content.trim().slice(0, 2000) }));
  const last = [...turns].reverse().find((t) => t.role === "user")?.content.slice(0, 600) ?? "";
  if (last.length < 1) throw new Error("Ask me something");
  // A follow-up ("cheaper ones?") is understood with the question before it.
  const prevUser = [...turns].reverse().filter((t) => t.role === "user")[1]?.content ?? "";
  const query = last.length < 40 && prevUser && !GREETING.test(last) && !THANKS.test(last) ? `${prevUser} ${last}` : last;
  const found = await lookUp(who, query);
  const links = found.table ? [] : found.kb.flatMap((p) => p.links).slice(0, 3) as [string, string][];
  if (found.searched) links.unshift(["/browse", "Search all property"]);
  // Messages must alternate and start with the person: drop anything before their first message.
  const firstUser = turns.findIndex((t) => t.role === "user");
  const convo = turns.slice(firstUser).filter((t, i, a) => i === 0 || t.role !== a[i - 1].role);
  const out = await runAi<string>({
    actor: { userId: who.userId ?? null, companyId: who.companyId ?? null, visitorKey: who.visitorKey }, feature: "CHAT", inputChars: convo.reduce((n, t) => n + t.content.length, 0),
    rules: async () => rulesAnswer(who, last, found),
    assist: async (provider, signal) => {
      if (!provider.chat) return null;
      const r = await provider.chat({ system: SYSTEM(who, contextFor(found)), messages: convo, maxTokens: 700, signal });
      return r.ok ? r.text.trim().slice(0, 4000) : null;
    },
  });
  return { text: out.result, cards: found.cards, table: found.table, links: [...new Map(links.map((l) => [l[0], l])).values()].slice(0, 3), source: out.source, notice: out.notice };
}
