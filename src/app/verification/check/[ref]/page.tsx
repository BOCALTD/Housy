import Link from "next/link";
import { notFound } from "next/navigation";
import { checkReport } from "@/lib/services/verification-cases";
import { day, outcomeName } from "../../case-ui";

export const metadata = { title: "Verification report check", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The public check of a report: genuine or not, current version, revoked or superseded. Nothing confidential is shown. */
export default async function ReportCheck({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const r = await checkReport(decodeURIComponent(ref).toUpperCase());
  if (!r) notFound();
  const current = r.versions.find((v) => !v.supersededAt);
  return (
    <div className="wrap stack-lg vp" style={{ maxWidth: 720 }}>
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/verification/check">Check another report</Link>
        <h1>Report {r.publicRef}</h1>
      </div>
      {current?.revokedAt ? (
        <div className="flash error" role="status"><strong>Revoked.</strong> This report was withdrawn on {day(current.revokedAt)} and must not be relied on. Reason: {current.revokedReason}</div>
      ) : (
        <div className="flash" role="status"><strong>Genuine.</strong> This report was issued through Housy&apos;s verification network. The current version is {current?.version}.</div>
      )}
      <section className="card stack">
        <dl className="vp-dl">
          <dt>Issued by</dt><dd>{r.provider?.name} ({r.provider?.providerCode}){r.provider?.suspendedAt ? <span className="small warn-text"> · currently suspended on Housy</span> : null}</dd>
          <dt>Housy case</dt><dd>{r.caseRef}</dd>
          <dt>Property</dt><dd>{r.propertyType?.toLowerCase().replace(/_/g, " ")} in {r.state}</dd>
        </dl>
        <h2>Versions</h2>
        <ul className="vp-list">{r.versions.map((v) => (
          <li key={v.version}><span className="stack" style={{ gap: 2 }}><strong>Version {v.version} · {outcomeName(v.outcome)}</strong>
            <span className="small muted">Released {day(v.releasedAt)} · {v.revokedAt ? "revoked" : v.supersededAt ? "superseded by a corrected version" : "current"}</span>
            <span className="small muted mono" style={{ overflowWrap: "anywhere" }}>Fingerprint {v.sha256}</span></span></li>
        ))}</ul>
        <p className="small muted">To confirm a copy you were given, compare the fingerprint printed at the end of the report with the one above. The report is the issuing provider&apos;s professional opinion within its stated scope; the property&apos;s address and the parties are not shown here.</p>
      </section>
    </div>
  );
}
