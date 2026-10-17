import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureReputation, publicCompany, publicReviews } from "@/lib/services/reviews";
import { tierOf } from "@/lib/services/tiers";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { BadgeRow, ReviewCard, ScoreLine } from "@/components/Reputation";
import { GoldBadge } from "@/components/Promo";
import { reportReviewAction } from "../../reviews/actions";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  const c = await publicCompany(params.id);
  return { title: c ? c.displayName : "Company not available" };
}

export default async function CompanyPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const company = await publicCompany(params.id);
  if (!company) notFound();
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [rep, list, session, tier] = await Promise.all([ensureReputation("COMPANY", company.companyId), publicReviews("COMPANY", company.companyId, page), getSession(), tierOf(company.companyId)]);
  const here = `/companies/${company.companyId}`;
  return (
    <div className="stack-lg">
      <div className="card stack">
        <p className="eyebrow">{company.kind === "DEVELOPER" ? "Developer" : "Company"}</p>
        <h1>{company.displayName} <GoldBadge tier={tier} /></h1>
        {company.tagline ? <p className="muted">{company.tagline}</p> : null}
        <ScoreLine score={rep?.score ?? 0} count={rep?.reviewCount ?? 0} average={rep?.average ?? 0} />
        <BadgeRow badges={(rep?.badges as string[] | undefined) ?? []} />
        <p className="small muted">The Gold badge reflects a paid plan. Reputation and review badges are earned and cannot be bought.</p>
        {company.about ? <p style={{ whiteSpace: "pre-line", maxWidth: "65ch" }}>{company.about}</p> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Reviews ({list.total})</h2>
        {list.rows.length === 0 ? <p className="muted">No reviews yet.</p> : (
          <ul className="timeline">{list.rows.map((r) => (
            <li key={r.id}><ReviewCard r={r} report={session ? (
              <details className="inline"><summary>Report this review</summary>
                <form action={reportReviewAction} className="stack"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} />
                  <Field label="What is wrong with it?"><input name="reason" required minLength={5} maxLength={500} /></Field><button className="btn" type="submit">Report</button></form></details>
            ) : null} /></li>))}</ul>
        )}
        <div className="row between">
          {list.page > 0 ? <Link className="btn" href={`${here}?page=${list.page - 1}`}>Previous</Link> : <span />}
          {list.page + 1 < list.pages ? <Link className="btn" href={`${here}?page=${list.page + 1}`}>Next</Link> : <span />}
        </div>
      </section>
    </div>
  );
}
