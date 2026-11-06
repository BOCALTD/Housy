import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listingsToConfirm } from "@/lib/services/listings";
import { CONFIRM_EVERY_DAYS } from "@/lib/match-rules";
import { formatDate } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";
import { confirmListingsAction } from "./actions";

export const metadata = { title: "Still available?" };
export const dynamic = "force-dynamic";

/** Live listings to confirm: anything not confirmed for 45 days stops showing in search, so buyers and renters only see homes that are really available. */
export default async function ListingsCheckPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const member = await requireMember("listing.manage");
  const rows = await listingsToConfirm(member);
  const hidden = rows.filter((r) => r.expired).length;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Still available?</h1>
        <p className="muted">Every {CONFIRM_EVERY_DAYS} days Housy asks you to confirm each live listing. Listings that are not confirmed stop showing in search (nothing is deleted), so people only see homes they can actually get.</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      {rows.length === 0 ? (
        <section className="card art-empty"><div className="art-empty-ico" aria-hidden="true">✅</div><h2>All confirmed</h2><p className="muted">Nothing needs checking. We will remind you a week before any listing is due.</p><Link className="btn" href="/app/assets">Your properties</Link></section>
      ) : (
        <form action={confirmListingsAction} className="card stack">
          <p>{hidden ? <><strong>{hidden}</strong> {hidden === 1 ? "listing has" : "listings have"} stopped showing. </> : null}Tick the ones that are still available. Anything taken: open it and mark it unavailable.</p>
          <ul className="list-rows">
            {rows.map((r) => (
              <li key={r.id} className="row between">
                <label className="check" style={{ flex: 1, minWidth: 0 }}><input type="checkbox" name="id" value={r.id} defaultChecked /> <span><strong>{r.title}</strong><span className="small muted"> · {r.publicRef}</span></span></label>
                <span className={`pill ${r.expired ? "bad" : "warn"}`}>{r.expired ? "Not showing" : `Due ${formatDate(r.due)}`}</span>
                <Link className="small" href={`/properties/${r.publicRef}`}>View</Link>
              </li>
            ))}
          </ul>
          <button className="btn primary" type="submit">Confirm the ticked listings are still available</button>
        </form>
      )}
    </div>
  );
}
