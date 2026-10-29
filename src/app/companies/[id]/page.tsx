import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureReputation, publicCompany, publicReviews } from "@/lib/services/reviews";
import { tierOf } from "@/lib/services/tiers";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { BadgeRow, ReviewCard, ScoreLine } from "@/components/Reputation";
import { GoldBadge } from "@/components/Promo";
import { companyTrust } from "@/lib/services/kyc";
import { TrustBadge } from "@/components/TrustBadge";
import { reportReviewAction } from "../../reviews/actions";
import ShareButton from "@/components/ShareButton";
import { SignupNudge } from "@/components/SignupNudge";
import { GUEST_REVIEWS, shareText } from "@/lib/share-rules";
import { PLATFORM_NAME } from "@/lib/labels";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  const c = await publicCompany(params.id);
  if (!c) return { title: "Company not available" };
  const description = c.tagline || c.about.slice(0, 180) || `See ${c.displayName}'s properties and reviews on ${PLATFORM_NAME}.`;
  return {
    title: c.displayName, description, alternates: { canonical: `/companies/${c.companyId}` },
    openGraph: { type: "profile", siteName: PLATFORM_NAME, title: c.displayName, description, url: `/companies/${c.companyId}` },
    twitter: { card: "summary_large_image", title: c.displayName, description },
  };
}

export default async function CompanyPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const company = await publicCompany(params.id);
  if (!company) notFound();
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [rep, list, session, tier, trust] = await Promise.all([ensureReputation("COMPANY", company.companyId), publicReviews("COMPANY", company.companyId, page), getSession(), tierOf(company.companyId), companyTrust(company.companyId)]);
  const here = `/companies/${company.companyId}`;
  // Visitors who are not signed in see the newest few reviews; the rest are behind a free sign-up.
  const guest = !session;
  const rows = guest ? list.rows.slice(0, GUEST_REVIEWS) : list.rows;
  return (
    <div className="stack-lg">
      <div className="card stack">
        <p className="eyebrow">{company.kind === "DEVELOPER" ? "Developer" : "Company"}</p>
        <h1>{company.displayName} <GoldBadge tier={tier} /></h1>
        {company.tagline ? <p className="muted">{company.tagline}</p> : null}
        <TrustBadge t={trust} full />
        <ScoreLine score={rep?.score ?? 0} count={rep?.reviewCount ?? 0} average={rep?.average ?? 0} />
        <BadgeRow badges={(rep?.badges as string[] | undefined) ?? []} />
        <p className="small muted">The Gold badge reflects a paid plan. Reputation and review badges are earned and cannot be bought.</p>
        {company.about ? <p style={{ whiteSpace: "pre-line", maxWidth: "65ch" }}>{company.about}</p> : null}
        <div className="row">
          <ShareButton kind="company" path={here} signedIn={!guest} title={company.displayName}
            text={shareText("company", { title: company.displayName, place: company.tagline, details: rep && rep.reviewCount > 0 ? [`★ ${rep.average.toFixed(1)} from ${rep.reviewCount} review${rep.reviewCount === 1 ? "" : "s"}`] : [], by: company.kind === "DEVELOPER" ? "Property developer" : "Property company" }, PLATFORM_NAME)} />
        </div>
      </div>
      {guest ? <SignupNudge path={here} shared={sp(searchParams, "shared") === "1"} what={company.displayName} perks={["Every review and their listed properties", "Follow them for new listings", "Message them safely, without sharing your number"]} /> : null}
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Reviews ({list.total})</h2>
        {rows.length === 0 ? <p className="muted">No reviews yet.</p> : (
          <ul className="timeline">{rows.map((r) => (
            <li key={r.id}><ReviewCard r={r} report={session ? (
              <details className="inline"><summary>Report this review</summary>
                <form action={reportReviewAction} className="stack"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} />
                  <Field label="What is wrong with it?"><input name="reason" required minLength={5} maxLength={500} /></Field><button className="btn" type="submit">Report</button></form></details>
            ) : null} /></li>))}</ul>
        )}
        {guest && list.total > rows.length ? <p className="small"><Link href={`/join?next=${encodeURIComponent(here)}`}>Sign up free</Link> to read all {list.total} reviews.</p> : null}
        <div className="row between" hidden={guest}>
          {list.page > 0 ? <Link className="btn" href={`${here}?page=${list.page - 1}`}>Previous</Link> : <span />}
          {list.page + 1 < list.pages ? <Link className="btn" href={`${here}?page=${list.page + 1}`}>Next</Link> : <span />}
        </div>
      </section>
    </div>
  );
}
