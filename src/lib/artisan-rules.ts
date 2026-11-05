/** The trades artisans register under, in the words people use in Nigeria. */
export const TRADES = {
  electrician: "Electrician",
  plumber: "Plumber",
  carpenter: "Carpenter",
  mason: "Mason (bricklayer)",
  painter: "Painter",
  tiler: "Tiler",
  welder: "Welder and iron bender",
  ac: "AC and fridge technician",
  pop: "POP ceiling and screeding",
  roofer: "Roofer",
  aluminium: "Aluminium and glass",
  solar: "Solar and inverter installer",
  generator: "Generator technician",
  cctv: "CCTV and security systems",
  cleaner: "Cleaner",
  fumigation: "Fumigation and pest control",
  movers: "Movers and haulage",
  interior: "Interior decorator",
  gardener: "Gardener and landscaper",
  locksmith: "Locksmith",
} as const;
export type Trade = keyof typeof TRADES;
export const TRADE_KEYS = Object.keys(TRADES) as Trade[];
/** The trades shown first to someone who has just moved in. */
export const MOVING_IN: Trade[] = ["electrician", "plumber", "painter", "carpenter", "cleaner", "movers", "ac", "fumigation", "solar", "mason"];

export function tradeLabel(t: string): string { return (TRADES as Record<string, string>)[t] ?? t; }
export function cleanTrades(input: unknown): Trade[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const out = list.map((x) => String(x).trim()).filter((x): x is Trade => (TRADE_KEYS as string[]).includes(x));
  return [...new Set(out)].slice(0, 6);
}
export const REQUEST_STATUS = { OPEN: "Waiting for the company", ARRANGED: "Arranged", DONE: "Done", CANCELLED: "Cancelled" } as const;

/** Requests a client can rate: once the company has arranged the job (or marked it done) and named the artisan. */
export const RATEABLE = ["ARRANGED", "DONE"] as const;

export type RankInput = { id: string; trades: string[]; areas: string; yearsExperience: number | null; verified: boolean; stars: number; reviews: number; jobsDone: number };
export type Ranked<T> = T & { score: number; reasons: string[]; tradeMatch: boolean; areaMatch: boolean };

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s,]/g, " ");
/** The places an artisan says they work in ("Lekki, Ajah, VI") as lower-case names of at least three letters. */
export function areaNames(areas: string): string[] {
  return [...new Set(words(areas).split(/[,/]| and /).map((a) => a.trim().replace(/\s+/g, " ")).filter((a) => a.length >= 3))];
}
/** Whether any of the artisan's areas is named in the property's place (city, state or address). */
export function servesPlace(areas: string, place: string): boolean {
  const p = ` ${words(place).replace(/,/g, " ").replace(/\s+/g, " ")} `;
  return areaNames(areas).some((a) => p.includes(` ${a} `));
}

/**
 * A rating that is fair to artisans with few jobs: their average is pulled toward a neutral 3.5 until they have a few
 * ratings, so one five-star job does not outrank twenty four-and-a-half-star ones.
 */
export function fairStars(stars: number, reviews: number): number {
  if (reviews <= 0) return 0;
  return (stars * reviews + 3.5 * 3) / (reviews + 3);
}

/**
 * Rank a company's artisans for one client: the trade they need first, then whether the artisan works where the property is,
 * then a verified ID, ratings, jobs done and experience. Every point is explained, so the client sees why someone is first.
 */
export function rankArtisans<T extends RankInput>(list: T[], want: { trade?: string; place?: string }): Ranked<T>[] {
  return list.map((a) => {
    const reasons: string[] = [];
    let score = 0;
    const tradeMatch = !!want.trade && a.trades.includes(want.trade);
    if (want.trade) { if (tradeMatch) { score += 50; reasons.push(`Does ${tradeLabel(want.trade).toLowerCase()} work`); } }
    const areaMatch = !!want.place && !!a.areas && servesPlace(a.areas, want.place);
    if (areaMatch) { score += 40; reasons.push("Works in your area"); }
    if (a.verified) { score += 12; reasons.push("ID verified"); }
    if (a.reviews > 0) { const f = fairStars(a.stars, a.reviews); score += Math.round((f - 2.5) * 6); reasons.push(`${a.stars.toFixed(1)} ★ from ${a.reviews} ${a.reviews === 1 ? "rating" : "ratings"}`); }
    if (a.jobsDone > 0) { score += Math.min(a.jobsDone, 10); reasons.push(`${a.jobsDone} ${a.jobsDone === 1 ? "job" : "jobs"} done through Housy`); }
    if (a.yearsExperience) score += Math.min(a.yearsExperience, 20) / 4;
    return { ...a, score: Math.round(score * 10) / 10, reasons, tradeMatch, areaMatch };
  }).sort((x, y) => y.score - x.score || y.reviews - x.reviews);
}
