import { PdfDoc } from "./pdf";
import { formatKobo } from "./money";

export type StatementData = {
  companyName: string;
  ownerName: string;
  from: string;
  to: string;
  generatedAt: Date;
  properties: {
    name: string; ref: string; address: string;
    leases: { ref: string; occupant: string; unit: string; chargedKobo: bigint; receivedKobo: bigint; outstandingKobo: bigint; receipts: { no: string; paidOn: string; amountKobo: bigint }[] }[];
    jobs: { ref: string; title: string; completedOn: string; costKobo: bigint | null }[];
  }[];
  totals: { charged: bigint; received: bigint; outstanding: bigint; maintenance: bigint; net: bigint };
};

const AMBER: [number, number, number] = [0.984, 0.69, 0.09];
const INK: [number, number, number] = [0.12, 0.13, 0.15];
const MUTED: [number, number, number] = [0.36, 0.38, 0.44];
const SOFT: [number, number, number] = [0.965, 0.969, 0.976];
const money = (k: bigint) => formatKobo(k);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** An owner's statement as a PDF: summary first, then each property's tenancies, receipts and maintenance. */
export function renderStatement(d: StatementData): Uint8Array {
  const pdf = new PdfDoc(`${d.companyName} · statement for ${d.ownerName} · ${day(d.from)} to ${day(d.to)}`);
  const L = pdf.margin, R = pdf.margin + pdf.width;

  // Heading band
  pdf.rect(0, pdf.y - 6, 595.28, 60, SOFT);
  pdf.rect(0, pdf.y - 6, 6, 60, AMBER);
  pdf.text(L, pdf.y + 30, "OWNER STATEMENT", { size: 8, bold: true, color: MUTED });
  pdf.text(L, pdf.y + 10, d.ownerName, { size: 18, bold: true });
  pdf.text(R, pdf.y + 30, d.companyName, { size: 10, bold: true, align: "right" });
  pdf.text(R, pdf.y + 14, `${day(d.from)} to ${day(d.to)}`, { size: 10, align: "right", color: MUTED });
  pdf.y -= 34;

  // Summary
  const boxes: [string, bigint][] = [["Rent due in period", d.totals.charged], ["Rent received", d.totals.received], ["Maintenance paid", d.totals.maintenance], ["Net before fees", d.totals.net]];
  const bw = (pdf.width - 3 * 10) / 4;
  pdf.y -= 8;
  boxes.forEach(([label, v], i) => {
    const x = L + i * (bw + 10);
    pdf.rect(x, pdf.y - 44, bw, 44, SOFT);
    pdf.text(x + 8, pdf.y - 16, label, { size: 8, color: MUTED });
    pdf.text(x + 8, pdf.y - 34, money(v), { size: 12, bold: true, color: i === 3 && v < 0n ? [0.6, 0.12, 0.15] : INK });
  });
  pdf.y -= 58;
  pdf.para(`Still outstanding on rent that fell due by ${day(d.to)}: ${money(d.totals.outstanding)}. Received means money recorded on receipts dated in the period that have not been reversed. Management fees and other charges are not included; ${d.companyName} shows those separately.`, { size: 8.5, color: MUTED, gap: 10 });

  if (d.properties.length === 0) pdf.para("No properties on this statement.", { size: 10 });
  for (const p of d.properties) {
    pdf.ensure(80);
    pdf.y -= 8;
    pdf.line(L, pdf.y, R, pdf.y, AMBER, 1.2);
    pdf.y -= 16;
    pdf.text(L, pdf.y, p.name, { size: 12, bold: true });
    pdf.text(R, pdf.y, p.ref, { size: 9, color: MUTED, align: "right" });
    if (p.address) { pdf.y -= 13; pdf.text(L, pdf.y, p.address, { size: 8.5, color: MUTED }); }
    pdf.y -= 8;

    if (p.leases.length === 0) pdf.para("No tenancies in this period.", { size: 9, color: MUTED });
    for (const l of p.leases) {
      pdf.ensure(46);
      pdf.y -= 14;
      pdf.text(L, pdf.y, `${l.occupant}${l.unit ? ` · ${l.unit}` : ""}`, { size: 10, bold: true });
      pdf.text(R, pdf.y, l.ref, { size: 8.5, color: MUTED, align: "right" });
      pdf.y -= 13;
      pdf.text(L, pdf.y, `Due ${money(l.chargedKobo)}`, { size: 9 });
      pdf.text(L + 150, pdf.y, `Received ${money(l.receivedKobo)}`, { size: 9 });
      pdf.text(L + 310, pdf.y, `Outstanding ${money(l.outstandingKobo)}`, { size: 9, color: l.outstandingKobo > 0n ? [0.6, 0.12, 0.15] : INK });
      for (const r of l.receipts) {
        pdf.ensure(14);
        pdf.y -= 12;
        pdf.text(L + 12, pdf.y, `Receipt ${r.no} · ${day(r.paidOn)}`, { size: 8.5, color: MUTED });
        pdf.text(R, pdf.y, money(r.amountKobo), { size: 8.5, color: MUTED, align: "right" });
      }
      pdf.y -= 4;
    }

    if (p.jobs.length) {
      pdf.ensure(30);
      pdf.y -= 14;
      pdf.text(L, pdf.y, "Maintenance completed", { size: 9.5, bold: true });
      for (const j of p.jobs) {
        pdf.ensure(14);
        pdf.y -= 12;
        const title = `${j.ref} · ${j.title}`;
        pdf.text(L + 12, pdf.y, title.length > 80 ? `${title.slice(0, 79)}...` : title, { size: 8.5 });
        pdf.text(R - 110, pdf.y, day(j.completedOn), { size: 8.5, color: MUTED, align: "right" });
        pdf.text(R, pdf.y, j.costKobo === null ? "No cost recorded" : money(j.costKobo), { size: 8.5, align: "right" });
      }
    }
  }

  pdf.ensure(30);
  pdf.y -= 18;
  pdf.para(`Prepared from ${d.companyName}'s records on ${d.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} (Lagos time). Ask ${d.companyName} to correct anything that looks wrong.`, { size: 8, color: MUTED });
  return pdf.bytes({ title: `Owner statement ${d.from} to ${d.to}`, author: d.companyName });
}
