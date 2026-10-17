import Link from "next/link";
import { headers } from "next/headers";
import { smartSearch } from "@/lib/services/ai-search";
import { viewerKeyFor } from "@/lib/services/ads";
import { isBot } from "@/lib/ad-rules";
import { formatKobo } from "@/lib/money";
import { PropPhoto, sp, type SP } from "@/components/ui";
import { coverPhotoIdsByRef } from "@/lib/services/listing-photos";

export const metadata = { title: "Describe the property you want" };
export const dynamic = "force-dynamic";

const naira = (k: number) => formatKobo(BigInt(k));

export default async function FindPage({ searchParams }: { searchParams?: SP }) {
  const q = (sp(searchParams, "q") ?? "").slice(0, 300);
  const ua = headers().get("user-agent") ?? "";
  const r = q.trim().length >= 3 && !isBot(ua) ? await smartSearch(q, viewerKeyFor(headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "local", ua)) : null;
  const covers = r ? await coverPhotoIdsByRef(r.found.map((f) => f.listing.publicRef)).catch(() => new Map<string, string>()) : new Map<string, string>();
  const u = r?.understood;
  const chips = u ? [
    u.purpose ? `For ${u.purpose.toLowerCase()}` : null,
    u.city ? u.city : u.state ? u.state : null,
    u.minBeds !== undefined ? `${u.minBeds}+ bedrooms` : null,
    u.maxPriceKobo !== undefined ? `Up to ${naira(u.maxPriceKobo)}` : null,
    u.minPriceKobo !== undefined ? `From ${naira(u.minPriceKobo)}` : null,
    ...u.keywords,
  ].filter((x): x is string => Boolean(x)) : [];
  return (
    <div className="stack-lg">
      <section className="hero">
        <p className="eyebrow" style={{ color: "inherit", opacity: 0.8 }}>Search by describing it</p>
        <h1>Tell us what you are looking for.</h1>
        <p>For example: &ldquo;3 bedroom flat to rent in Lekki under ₦5m&rdquo;.</p>
        <form className="search" role="search" aria-label="Describe the property">
          <input name="q" defaultValue={q} maxLength={300} required minLength={3} placeholder="Describe the property, place and budget" aria-label="Describe the property you want" />
          <button className="btn primary" type="submit">Find</button>
        </form>
      </section>
      {r ? (
        <section className="stack" aria-live="polite">
          {r.nothingUnderstood ? (
            <div className="card"><p>We could not tell what to look for. Try naming a place, whether you want to rent or buy, the number of bedrooms or a budget. Or use the <Link href="/">usual search</Link>.</p></div>
          ) : (
            <>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}><span className="small muted">We looked for:</span>{chips.map((c) => <span className="pill brand" key={c}>{c}</span>)}</div>
              <p className="small muted">{r.source === "AI" ? "Your sentence was read with the help of an AI service; the matching and ranking below are done by the platform." : r.notice || "Your sentence was read by the platform's own rules."} Matches are suggestions: always check the details of a property yourself.</p>
              {r.found.length === 0 ? <div className="card"><p className="muted">No published property matches that. Try a wider area or a higher budget.</p></div> : (
                <div className="grid">
                  {r.found.slice(0, 12).map((f) => <ResultCard key={f.listing.publicRef} f={f} cover={covers.get(f.listing.publicRef)} />)}
                </div>
              )}
              {r.found.length > 12 ? <details className="inline"><summary>Show {r.found.length - 12} more properties</summary><div className="grid">{r.found.slice(12).map((f) => <ResultCard key={f.listing.publicRef} f={f} cover={covers.get(f.listing.publicRef)} />)}</div></details> : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ResultCard({ f, cover }: { f: NonNullable<Awaited<ReturnType<typeof smartSearch>>>["found"][number]; cover?: string }) {
  const l = f.listing;
  return (
    <Link href={`/properties/${l.publicRef}`} className="prop">
      <div className="prop-img"><PropPhoto id={cover} /></div>
      <div className="prop-body">
        <span className="promo-tags"><span className="pill brand">{l.purpose === "SALE" ? "For sale" : `For ${l.purpose.toLowerCase()}`}</span><span className={`pill ${f.exact ? "ACTIVE" : "PENDING"}`}>{f.exact ? "Matches" : "Close"} · {f.score}%</span></span>
        <strong>{l.title}</strong>
        <span>{formatKobo(l.priceKobo)}{l.purpose !== "SALE" ? " / year" : ""}</span>
        <span className="small muted">{[l.bedrooms != null ? `${l.bedrooms} bed` : null, `${l.city}, ${l.state}`].filter(Boolean).join(" · ")}</span>
        {f.reasons.length ? <span className="small">{f.reasons.slice(0, 3).join(" · ")}</span> : null}
        {f.misses.length ? <span className="small muted">{f.misses.slice(0, 2).join(" · ")}</span> : null}
      </div>
    </Link>
  );
}
