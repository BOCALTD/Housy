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
