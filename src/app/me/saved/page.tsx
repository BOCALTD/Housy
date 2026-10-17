import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { MAX_SAVED_SEARCHES, myWatched, mySearches } from "@/lib/services/alerts";
import { PURPOSES } from "@/lib/services/listings";
import { humanize } from "@/lib/labels";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { deleteSearchAction, saveSearchAction, toggleAlertsAction, unwatchAction } from "./actions";

export const metadata = { title: "Saved searches and watched properties" };
export const dynamic = "force-dynamic";

export default async function SavedPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const [searches, watched] = await Promise.all([mySearches(user.id), myWatched(user.id)]);
  const describe = (s: (typeof searches)[number]) => [s.purpose ? (s.purpose === "SALE" ? "Buy" : humanize(s.purpose)) : "", s.city, s.q ? `"${s.q}"` : "", s.maxKobo ? `up to ₦${Math.round(Number(s.maxKobo) / 100).toLocaleString("en-NG")}` : "", s.minBeds != null ? `${s.minBeds}+ beds` : ""].filter(Boolean).join(" · ");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Saved searches and watched properties</h1><p className="muted">We tell you when a new property matches a saved search, or when a property you watch changes. Choose how and when in your <Link href="/me/notification-settings">email settings</Link>.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Saved searches ({searches.length} of {MAX_SAVED_SEARCHES})</h2>
        {searches.length === 0 ? <p className="muted">None yet. Save one below, or search from the home page and choose "Save this search".</p> : (
          <ShowMore noun="more searches" limit={4} items={searches.map((s) => (
            <li key={s.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
              <div><strong>{s.name}</strong> <span className="small muted">{describe(s)}</span></div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Link className="btn small" href={`/?${new URLSearchParams(Object.entries({ city: s.city, purpose: s.purpose, q: s.q, minBeds: s.minBeds != null ? String(s.minBeds) : "", maxPrice: s.maxKobo ? String(Math.round(Number(s.maxKobo) / 100)) : "" }).filter(([, v]) => v)).toString()}`}>Run it now</Link>
                <form action={toggleAlertsAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="on" value={s.alertsOn ? "0" : "1"} /><button className="btn small" type="submit">{s.alertsOn ? "Alerts on: turn off" : "Alerts off: turn on"}</button></form>
                <form action={deleteSearchAction}><input type="hidden" name="id" value={s.id} /><button className="btn small" type="submit">Delete</button></form>
              </div>
            </div></li>))} />
        )}
        <details className="inline"><summary>Save a new search</summary>
          <form action={saveSearchAction} className="stack">
            <Field label="Name"><input name="name" required maxLength={80} placeholder="Two-bed flat in Lekki" /></Field>
            <Field label="Buy, rent or lease"><select name="purpose" defaultValue=""><option value="">Any</option>{PURPOSES.map((p) => <option key={p} value={p}>{p === "SALE" ? "Buy" : humanize(p)}</option>)}</select></Field>
            <Field label="City, area or state"><input name="city" maxLength={80} /></Field>
            <Field label="Words in the title"><input name="q" maxLength={120} /></Field>
            <Field label="Highest price (₦)"><input name="maxPrice" inputMode="decimal" /></Field>
            <Field label="Fewest bedrooms"><input name="minBeds" inputMode="numeric" /></Field>
            <button className="btn primary" type="submit">Save search</button>
          </form></details>
      </section>
      <section className="card stack">
        <h2>Watched properties ({watched.length})</h2>
        {watched.length === 0 ? <p className="muted">Open a property and choose "Watch this property" to hear when it is no longer available or comes back.</p> : (
          <ShowMore noun="more properties" limit={4} items={watched.map((w) => (
            <li key={w.id}><div className="row between" style={{ width: "100%" }}>
              <div>{w.listing && w.listing.status === "PUBLISHED" ? <Link href={`/properties/${w.listing.publicRef}`}>{w.listing.title}</Link> : <span>{w.listing?.title ?? "Property"} <span className="small muted">(not available now)</span></span>}</div>
              {w.listing ? <form action={unwatchAction}><input type="hidden" name="ref" value={w.listing.publicRef} /><button className="btn small" type="submit">Stop watching</button></form> : null}
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
