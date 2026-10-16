import { requireMember } from "@/lib/auth";
import { companyReviewDesk } from "@/lib/services/reviews";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { ReviewCard } from "@/components/Reputation";
import { disputeAction, inviteAction, respondAction, revokeInviteAction } from "./actions";

export const metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

export default async function CompanyReviewsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("crm.manage");
  const desk = await companyReviewDesk(member);
  const inviteForm = (basis: "TRANSACTION" | "INSPECTION", ref: string, state: string) => state === "REVIEWED" ? <span className="small muted">Reviewed</span> : (
    <div className="row">
      <form action={inviteAction} className="row"><input type="hidden" name="basis" value={basis} /><input type="hidden" name="basisRef" value={ref} />
        <label className="check"><input type="checkbox" name="aboutCompany" /> <span>About the company</span></label>
        <button className="btn small" type="submit">{state === "NONE" ? "Create review link" : "New link"}</button></form>
      {state === "OPEN" ? <form action={revokeInviteAction}><input type="hidden" name="basis" value={basis} /><input type="hidden" name="basisRef" value={ref} /><button className="btn small" type="submit">Cancel link</button></form> : null}
    </div>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Reviews</h1>
        <p className="muted">Clients can review you after a real conversation, or with a one-time link you give them after a completed viewing or deal. You can reply once to each review and dispute one you believe is false. Reviews cannot be bought or removed on request.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Reviews about you ({desk.reviews.length})</h2>
        {desk.reviews.length === 0 ? <p className="muted">No reviews yet.</p> : (
          <ShowMore noun="more reviews" limit={4} items={desk.reviews.map((r) => (
            <li key={r.id}><div className="stack" style={{ width: "100%" }}>
              <ReviewCard r={r} />
              {r.status === "HIDDEN" ? <Pill status="SUSPENDED" label="Hidden by the platform" /> : null}
              {r.dispute ? <p className="small">Dispute {humanize(r.dispute.status).toLowerCase()}{r.dispute.decision ? `: ${r.dispute.decision}` : ""}</p> : null}
              {r.status === "PUBLISHED" && !r.response ? <details className="inline"><summary>Reply</summary>
                <form action={respondAction} className="stack"><input type="hidden" name="id" value={r.id} /><Field label="Your reply (public)"><textarea name="reply" rows={3} required maxLength={1500} /></Field><button className="btn" type="submit">Post reply</button></form></details> : null}
              {r.status === "PUBLISHED" && !r.dispute ? <details className="inline"><summary>Dispute this review</summary>
                <form action={disputeAction} className="stack"><input type="hidden" name="id" value={r.id} /><Field label="What is untrue or against the rules?"><textarea name="reason" rows={3} required minLength={10} maxLength={1000} /></Field><button className="btn" type="submit">Send to the platform team</button></form></details> : null}
            </div></li>))} />
        )}
      </section>

      <section className="card stack">
        <h2>Ask a client for a review</h2>
        <p className="small muted">A link works once, for 30 days, and only for a completed {`viewing or deal`}. Give it to the client yourself. We never send it for you.</p>
        <h3>Completed deals ({desk.deals.length})</h3>
        {desk.deals.length === 0 ? <p className="muted">No completed deals yet.</p> : <ShowMore noun="more deals" limit={4} items={desk.deals.map((d) => <li key={d.id}><div className="row between" style={{ width: "100%" }}><div><strong>{d.title}</strong> <span className="small muted mono">{d.ref}</span></div>{inviteForm("TRANSACTION", d.id, d.invite)}</div></li>)} />}
        <h3>Completed viewings ({desk.viewings.length})</h3>
        {desk.viewings.length === 0 ? <p className="muted">No completed viewings yet.</p> : <ShowMore noun="more viewings" limit={4} items={desk.viewings.map((v) => <li key={v.id}><div className="row between" style={{ width: "100%" }}><div>Viewing on {formatDate(v.startsAt)}</div>{inviteForm("INSPECTION", v.id, v.invite)}</div></li>)} />}
      </section>
    </div>
  );
}
