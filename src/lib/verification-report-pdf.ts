import { requestTimeZone } from "./money-context";
import { PdfDoc } from "./pdf";
import { FINDING_BASES, OUTCOMES, type ReportContent } from "./verification-case-rules";

export type ReportPdfData = {
  caseRef: string;
  publicRef: string;
  version: number;
  provider: { name: string; legalName: string; code: string; cac: string };
  property: { address: string; state: string; type: string };
  requester: string;
  content: ReportContent;
  preparedBy: { name: string; credentials: string };
  reviewedBy: string;
  providerApprovedAt: Date;
  platformReviewer: string;
  platformApprovedAt: Date | null;
  releasedAt: Date | null;
  sha256: string;
  verifyUrl: string;
  status: "current" | "superseded" | "revoked" | "draft";
  correctionOf: number | null;
  correctionReason: string;
};

const INK: [number, number, number] = [0.12, 0.13, 0.15];
const MUTED: [number, number, number] = [0.36, 0.38, 0.44];
const SOFT: [number, number, number] = [0.965, 0.969, 0.976];
const BRASS: [number, number, number] = [0.83, 0.69, 0.38];
const RED: [number, number, number] = [0.6, 0.12, 0.15];
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: requestTimeZone() });

/**
 * The provider's professional report as a PDF. It says clearly that it is the provider's report; Housy's quality review is
 * shown separately at the end, with the fingerprint and the address where anyone can check the report is genuine.
 */
export function renderVerificationReport(d: ReportPdfData): Uint8Array {
  const pdf = new PdfDoc(`${d.provider.name} · verification report ${d.publicRef} v${d.version} · fingerprint ${d.sha256.slice(0, 16) || "not released"}`);
  const L = pdf.margin, R = pdf.margin + pdf.width;
  pdf.rect(0, pdf.y - 10, 595.28, 74, SOFT);
  pdf.rect(0, pdf.y - 10, 6, 74, BRASS);
  pdf.text(L, pdf.y + 40, "PROPERTY VERIFICATION REPORT", { size: 8, bold: true, color: MUTED });
  pdf.text(L, pdf.y + 18, d.provider.name, { size: 17, bold: true });
  pdf.text(L, pdf.y + 2, `${d.provider.legalName}${d.provider.cac ? ` · ${d.provider.cac}` : ""} · Housy provider ${d.provider.code}`, { size: 8.5, color: MUTED });
  pdf.text(R, pdf.y + 40, `Report ${d.publicRef}`, { size: 9, bold: true, align: "right" });
  pdf.text(R, pdf.y + 26, `Version ${d.version}${d.releasedAt ? ` · ${day(d.releasedAt)}` : ""}`, { size: 9, align: "right", color: MUTED });
  pdf.text(R, pdf.y + 12, `Housy reference ${d.caseRef}`, { size: 9, align: "right", color: MUTED });
  pdf.y -= 36;
  if (d.status !== "current") {
    pdf.y -= 6;
    const word = d.status === "revoked" ? "REVOKED: this report has been withdrawn and must not be relied on." : d.status === "superseded" ? "SUPERSEDED: a corrected version of this report has been issued." : "DRAFT: not released; not for reliance.";
    pdf.para(word, { size: 10, bold: true, color: RED, gap: 6 });
  }
  if (d.correctionOf) pdf.para(`This version corrects version ${d.correctionOf}. Reason: ${d.correctionReason}`, { size: 9, color: MUTED, gap: 6 });

  const outcome = OUTCOMES.find((o) => o[0] === d.content.outcome)?.[1] ?? d.content.outcome;
  pdf.y -= 6;
  pdf.rect(L, pdf.y - 40, pdf.width, 40, SOFT);
  pdf.text(L + 10, pdf.y - 15, "OUTCOME", { size: 7.5, bold: true, color: MUTED });
  pdf.text(L + 10, pdf.y - 31, outcome, { size: 13, bold: true });
  pdf.y -= 52;

  const section = (title: string, body: string) => {
    if (!body.trim()) return;
    pdf.ensure(40);
    pdf.y -= 6;
    pdf.text(L, pdf.y - 10, title.toUpperCase(), { size: 8, bold: true, color: MUTED });
    pdf.y -= 14;
    for (const p of body.split(/\n+/)) pdf.para(p, { size: 10, gap: 3 });
  };
  section("Property", `${d.property.address}, ${d.property.state}. ${d.property.type}.`);
  section("Requested by", d.requester);
  section("Scope of the investigation", d.content.scope);
  section("Documents examined", d.content.documentsExamined);
  section("Sources consulted", d.content.sourcesConsulted);
  section("Registry search", d.content.registrySearch);
  section("Site inspection", d.content.siteInspection);
  if (d.content.findings.length) {
    pdf.ensure(40);
    pdf.y -= 6;
    pdf.text(L, pdf.y - 10, "FINDINGS", { size: 8, bold: true, color: MUTED });
    pdf.y -= 14;
    d.content.findings.forEach((f, i) => {
      const basis = FINDING_BASES.find((b) => b[0] === f.basis)?.[1] ?? f.basis;
      pdf.para(`${i + 1}. [${basis}] ${f.text}`, { size: 10, gap: 4 });
    });
    pdf.para("Each finding states what it rests on. A document examined or a registry search shows what the record says on the date checked; it is not by itself proof of ownership.", { size: 8, color: MUTED, gap: 6 });
  }
  section("Risks and inconsistencies identified", d.content.risks);
  section("Limitations of the investigation", d.content.limitations);
  section("Outstanding issues", d.content.outstanding);
  section("Professional observations", d.content.observations);
  section("Recommendations", d.content.recommendations);
  section("Conclusion", d.content.conclusion);

  pdf.ensure(110);
  pdf.y -= 10;
  pdf.line(L, pdf.y, R, pdf.y, BRASS, 1);
  pdf.y -= 4;
  pdf.para(`Prepared by ${d.preparedBy.name}${d.preparedBy.credentials ? ` (${d.preparedBy.credentials})` : ""}. Reviewed and approved for ${d.provider.name} by ${d.reviewedBy} on ${day(d.providerApprovedAt)}.`, { size: 9.5, gap: 4 });
  pdf.para(`This is the professional report of ${d.provider.name}, an independent provider on Housy, which is responsible for its contents.`, { size: 9, color: MUTED, gap: 8 });
  pdf.rect(L, pdf.y - 58, pdf.width, 58, SOFT);
  pdf.text(L + 10, pdf.y - 14, "HOUSY PLATFORM REVIEW (SEPARATE FROM THE PROVIDER'S OPINION)", { size: 7.5, bold: true, color: MUTED });
  pdf.text(L + 10, pdf.y - 28, d.platformApprovedAt ? `Quality and compliance review passed on ${day(d.platformApprovedAt)}${d.platformReviewer ? ` (${d.platformReviewer})` : ""}.` : "Not yet reviewed by Housy.", { size: 9, color: INK });
  pdf.text(L + 10, pdf.y - 41, `Check this report is genuine: ${d.verifyUrl}`, { size: 8.5, color: INK });
  pdf.text(L + 10, pdf.y - 53, `Fingerprint (SHA-256): ${d.sha256 || "given when released"}`, { size: 7, color: MUTED });
  pdf.y -= 66;
  return pdf.bytes({ title: `Verification report ${d.publicRef} v${d.version}`, author: d.provider.name });
}
