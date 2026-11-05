import { requireMember } from "@/lib/auth";
import { artisanDesk } from "@/lib/services/artisans";
import { REQUEST_STATUS, tradeLabel } from "@/lib/artisan-rules";
import { formatDate } from "@/lib/dates";
import { TradePicker } from "@/components/TradePicker";
import { decideApplicationAction, updateArtisanAction, updateRequestAction } from "./actions";

export const metadata = { title: "Artisans" };
export const dynamic = "force-dynamic";

export default async function ArtisanDeskPage() {
  const member = await requireMember("maintenance.manage");
  const { applications, roster, requests } = await artisanDesk(member);
  const offered = roster.filter((r) => r.offerToClients && r.active).length;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Artisans</h1>
        <p className="muted">Tradespeople registered with your company. Those you offer are shown to your clients when their deal closes (name, trades and areas only), and clients ask you to arrange them.</p>
      </div>
      <section className="stats" aria-label="Summary">
        <div className="stat"><b>{roster.length}</b><span>Artisans and contractors</span></div>
        <div className="stat"><b>{offered}</b><span>Offered to clients</span></div>
        <div className="stat"><b>{applications.length}</b><span>Waiting to join</span></div>
        <div className="stat"><b>{requests.length}</b><span>Client requests open</span></div>
      </section>

      <section className="card stack">
        <h2>Client requests</h2>
        {requests.length === 0 ? <p className="muted">No open requests.</p> : (
          <ul className="list-rows">{requests.map((r) => (
            <li key={r.id} className="stack" style={{ alignItems: "stretch" }}>
              <div><strong>{tradeLabel(r.trade)}</strong> for {r.user.name}<span className="small muted"> · {formatDate(r.createdAt)}{r.preferredOn ? ` · prefers ${formatDate(r.preferredOn)}` : ""}</span>
                <p className="small">{r.note}</p>{r.address ? <p className="small muted">{r.address}</p> : null}</div>
              <form action={updateRequestAction} className="fields">
                <input type="hidden" name="id" value={r.id} />
                <label className="field">Status<select name="status" defaultValue={r.status}>{Object.entries(REQUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="field">Artisan<select name="contractorId" defaultValue={r.contractorId ?? ""}><option value="">Not chosen yet</option>{roster.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label className="field">Note to the client<input name="note" maxLength={500} defaultValue={r.companyNote} placeholder="e.g. Tunde will call you on Friday morning." /></label>
                <button className="btn primary" type="submit">Update</button>
              </form>
            </li>
          ))}</ul>
        )}
      </section>

      {applications.length ? (
        <section className="card stack">
          <h2>Waiting to join</h2>
          <ul className="list-rows">{applications.map((a) => (
            <li key={a.id} className="stack" style={{ alignItems: "stretch" }}>
              <div><strong>{a.name}</strong><span className="small muted"> · {a.phone}{a.yearsExperience != null ? ` · ${a.yearsExperience} years` : ""}</span>
                <div className="art-tags">{a.trades.map((t) => <em key={t}>{tradeLabel(t)}</em>)}</div>
                <p className="small muted">Works in {a.areas}</p>{a.bio ? <p className="small">{a.bio}</p> : null}</div>
              <form action={decideApplicationAction} className="row">
                <input type="hidden" name="id" value={a.id} />
                <input name="note" maxLength={500} placeholder="Note (optional)" aria-label="Note to the applicant" />
                <button className="btn primary" type="submit" name="decision" value="approve">Approve</button>
                <button className="btn" type="submit" name="decision" value="decline">Decline</button>
              </form>
            </li>
          ))}</ul>
        </section>
      ) : null}

      <section className="card stack">
        <h2>Your artisans</h2>
        {roster.length === 0 ? <p className="muted">Nobody yet. Artisans register from the Artisans page, or add contractors under Maintenance.</p> : (
          <ul className="list-rows">{roster.map((c) => (
            <li key={c.id}>
              <details className="art-edit">
                <summary><strong>{c.name}</strong><span className="small muted"> · {c.trades.length ? c.trades.map(tradeLabel).join(", ") : c.trade || "No trade set"}</span>{c.offerToClients && c.active ? <span className="pill ok">Offered to clients</span> : null}{!c.active ? <span className="pill">Inactive</span> : null}</summary>
                <form action={updateArtisanAction} className="stack" style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <TradePicker selected={c.trades} />
                  <label className="field">Areas<input name="areas" maxLength={200} defaultValue={c.areas} /></label>
                  <label className="field">About<textarea name="bio" rows={2} maxLength={500} defaultValue={c.bio} /></label>
                  <label className="check"><input type="checkbox" name="offer" defaultChecked={c.offerToClients} /><span>Offer to my clients when their deal closes</span></label>
                  <button className="btn primary" type="submit">Save</button>
                </form>
              </details>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
