/**
 * What the Housy assistant knows about Housy itself. With an AI service connected these passages ground its answers; without
 * one, the closest passage is the answer. Plain facts about how the product works, nothing invented.
 */
export type Passage = { id: string; title: string; words: string[]; text: string; links: [string, string][] };

export const KNOWLEDGE: Passage[] = [
  { id: "what", title: "What Housy is", words: ["what", "housy", "about", "platform", "who", "you"],
    text: "Housy helps people in Nigeria find property they can trust, and gives agents and property companies one place to run their work. Every listing comes from a registered company and is checked before it goes live. You can search by city, budget and type, use the map, watch property reels, compare homes, see market prices, book inspections safely, find flatmates, and chat with agents.",
    links: [["/how-it-works", "How it works"], ["/browse", "Find property"]] },
  { id: "inspect", title: "Booking an inspection safely", words: ["inspection", "inspect", "viewing", "visit", "book", "see", "tour"],
    text: "Open a property and choose **Book an inspection**, or ask the agent in chat. You get a confirmation with the date, time and meeting point. Share your trip with someone you trust from the safety page while you go. **Golden rule: never pay before you inspect**, and never pay an \"inspection fee\" to a personal account.",
    links: [["/safety", "Safety and verification"], ["/me/inspections", "My inspections"]] },
  { id: "fraud", title: "Avoiding scams", words: ["scam", "fraud", "fake", "pay", "fee", "trust", "safe", "agent", "money", "deposit"],
    text: "Check the company's **trust level** badge, read reviews from closed deals, and inspect before paying anything. Pay to a company account, not a personal one, and get a receipt. If something feels wrong, report it from the listing or the chat; the Trust and Safety team looks at every report.",
    links: [["/trust", "Trust and Safety Centre"], ["/safety", "What our checks mean"]] },
  { id: "verify", title: "What \"verified\" means", words: ["verified", "verification", "badge", "trust", "level", "kyc", "cac", "check"],
    text: "Companies and agents earn trust levels by passing checks: company registration (CAC), a director's ID, office address, phone and email, tax number and professional membership. **Verified** means identity and business records were checked; it is not a guarantee about any single property.",
    links: [["/safety", "What our checks mean"]] },
  { id: "flatmates", title: "Finding a flatmate", words: ["flatmate", "roommate", "share", "room", "flat", "match", "matching"],
    text: "Make a flatmate profile (how you live, budget, move-in date, the kind of space and your must-haves). The match engine scores everyone in your city and shows the best first. When you both accept, you get a private chat room. Take the **flatmate ID check** for a verified badge, and you can choose to match only with verified people.",
    links: [["/flatmates", "Flatmates"], ["/flatmates/matches", "My matches"]] },
  { id: "artisans", title: "Artisans after you move in", words: ["artisan", "electrician", "plumber", "painter", "carpenter", "mason", "repair", "fix", "move", "moving"],
    text: "When your rent or purchase closes with a company on Housy, it offers you its artisans: electricians, plumbers, painters, carpenters, cleaners, movers and more. Ask for one from **Artisans for my home** and the company arranges it. Artisans register with companies from the Artisans page.",
    links: [["/me/artisans", "Artisans for my home"], ["/artisans", "Artisans"]] },
  { id: "list", title: "Listing a property", words: ["list", "listing", "sell", "let", "advertise", "post", "upload", "landlord", "owner"],
    text: "Listings come from registered companies and agents. Register your company or join as an agent, add the property in your workspace, add photos (many at once), then submit it for review. Once approved it goes live. Landlords can list through an agent or company they trust.",
    links: [["/join?as=company", "Register a company"], ["/join?as=agent", "Join as an agent"]] },
  { id: "agent", title: "Working as an agent", words: ["agent", "become", "join", "realtor", "commission", "switch"],
    text: "Join as an agent, or from **Profile and settings** choose **Work as an agent too** if you already have an account: you keep one account and switch between yourself and your agent workspace with one tap. Get verified, collect reviews from closed deals, and appear in the directory.",
    links: [["/join?as=agent", "Join as an agent"], ["/me/settings", "Profile and settings"]] },
  { id: "company", title: "Running a property company", words: ["company", "workspace", "tenant", "rent", "lease", "crm", "manage", "portfolio", "documents", "field"],
    text: "The company workspace holds your properties, listings, clients and deals, tenants and leases, rent and service charges, inspections (including the offline field kit), maintenance with contractors and artisans, documents and correspondence, reports and an accounting export.",
    links: [["/join?as=company", "Register a company"], ["/pricing", "Plans and pricing"]] },
  { id: "prices", title: "Market prices", words: ["price", "cost", "average", "market", "rent", "much", "expensive", "cheap", "area"],
    text: "Market prices show typical asking rents and sale prices by city and area from listings on Housy, the trend over recent months, and how many listings each figure is based on. Areas with too few listings are left blank rather than guessed.",
    links: [["/market", "Market prices"], ["/calculators", "Calculators"]] },
  { id: "plans", title: "Plans and pricing", words: ["plan", "pricing", "subscription", "free", "cost", "premium", "upgrade", "billing"],
    text: "Looking for property is free. Companies and agents can start free and upgrade for more listings, promotions and features; see the plans page for what each includes and the current prices.",
    links: [["/pricing", "Plans and pricing"]] },
  { id: "account", title: "Your account", words: ["account", "password", "sign", "login", "delete", "break", "privacy", "data", "profile", "photo"],
    text: "In **Profile and settings** you can change your photo and cover, edit your bio, switch how you use Housy, sign out, **take a break** (your profile is hidden and emails pause until you sign in again) or delete your account. Download your data from Privacy.",
    links: [["/me/settings", "Profile and settings"], ["/me/privacy", "Privacy and my data"]] },
  { id: "reels", title: "Property reels", words: ["reel", "video", "reels", "watch", "tiktok", "instagram"],
    text: "Reels are short property videos from agents. Swipe left on the home screen to open them. Anyone can watch; sign in to like, comment, save or share. Agents can add a song from Housy's licensed library.",
    links: [["/reels", "Property reels"]] },
  { id: "contact", title: "Getting help", words: ["help", "support", "contact", "problem", "issue", "complaint", "report"],
    text: "Use Contact and support for help with your account or a listing, and report anything unsafe from the listing or chat. Urgent safety concerns go to the Trust and Safety team.",
    links: [["/support", "Contact and support"], ["/trust", "Trust and Safety"]] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

/** The passages that best fit a question, best first. */
export function retrieve(question: string, n = 3): Passage[] {
  const words = new Set(norm(question));
  return KNOWLEDGE.map((p) => ({ p, s: p.words.reduce((t, w) => t + (words.has(w) || [...words].some((x) => x.startsWith(w) && w.length > 3) ? 1 : 0), 0) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.p);
}

/** Questions to start with. */
export const STARTERS = {
  public: ["Find me a 2-bedroom flat in Lekki under ₦5m a year", "How do I book an inspection safely?", "What does a verified agent mean?", "How does flatmate matching work?"],
  workspace: ["How much rent is overdue?", "Which leases end in the next 60 days?", "Show open maintenance jobs", "Find 3-bedroom houses for sale in Abuja"],
};
