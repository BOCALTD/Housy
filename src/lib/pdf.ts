// A small PDF writer for plain business documents (statements): text in Helvetica, lines and shaded boxes, A4 pages,
// automatic page breaks and "Page n of m" footers. No outside library, so it has nothing to keep up to date and is easy to test.
// Text is written in the standard WinAnsi encoding; characters it cannot show are replaced (the naira sign becomes "NGN ").

const W_REG: Record<string, number> = {};
const W_BOLD: Record<string, number> = {};
// Glyph widths (thousandths of the font size) for printable ASCII, from the standard Helvetica metrics.
const REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
for (let i = 0; i < REG.length; i++) { W_REG[String.fromCharCode(32 + i)] = REG[i]; W_BOLD[String.fromCharCode(32 + i)] = BOLD[i]; }

/** Make text safe for the standard fonts: known symbols become words, anything else outside Latin-1 becomes "?". */
export function pdfSafe(s: string): string {
  return s
    .replace(/₦\s?/g, "NGN ")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/ /g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

export function textWidth(s: string, size: number, bold = false): number {
  const w = bold ? W_BOLD : W_REG;
  let t = 0;
  for (const ch of pdfSafe(s)) t += w[ch] ?? 556;
  return (t * size) / 1000;
}

/** Break text into lines no wider than maxWidth. Very long words are cut. */
export function wrapText(s: string, size: number, maxWidth: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(s).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (textWidth(w, size, bold) > maxWidth) {
        let cut = w.length - 1;
        while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (textWidth(next, size, bold) > maxWidth && line) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}

const esc = (s: string) => pdfSafe(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
type RGB = [number, number, number];
const col = (c: RGB) => c.map((v) => (Math.round(v * 1000) / 1000).toString()).join(" ");

export const A4 = { width: 595.28, height: 841.89 };

export class PdfDoc {
  readonly margin = 48;
  private pages: string[][] = [];
  private cur: string[] = [];
  y = 0;
  constructor(private footer: string = "") { this.newPage(); }

  get width() { return A4.width - this.margin * 2; }

  newPage() {
    this.cur = [];
    this.pages.push(this.cur);
    this.y = A4.height - this.margin;
  }

  /** Start a new page if fewer than `need` points are left above the footer. */
  ensure(need: number) {
    if (this.y - need < this.margin + 24) this.newPage();
  }

  text(x: number, y: number, s: string, o: { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right" } = {}) {
    const size = o.size ?? 10;
    const px = o.align === "right" ? x - textWidth(s, size, o.bold) : x;
    this.cur.push(`BT /${o.bold ? "F2" : "F1"} ${size} Tf ${col(o.color ?? [0.12, 0.13, 0.15])} rg ${px.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = [0.85, 0.86, 0.88], width = 0.6) {
    this.cur.push(`${col(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rect(x: number, y: number, w: number, h: number, color: RGB) {
    this.cur.push(`${col(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  /** A paragraph at the cursor, wrapped to the page width, moving the cursor down. */
  para(s: string, o: { size?: number; bold?: boolean; color?: RGB; gap?: number; x?: number; width?: number } = {}) {
    const size = o.size ?? 10;
    const lead = size * 1.35;
    for (const l of wrapText(s, size, o.width ?? this.width, o.bold)) {
      this.ensure(lead);
      this.y -= lead;
      this.text(o.x ?? this.margin, this.y, l, o);
    }
    this.y -= o.gap ?? 4;
  }

  /** The finished file. */
  bytes(meta: { title: string; author?: string }): Uint8Array {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      const fy = this.margin - 20;
      p.push(`${col([0.85, 0.86, 0.88])} RG 0.6 w ${this.margin} ${fy + 14} m ${A4.width - this.margin} ${fy + 14} l S`);
      p.push(`BT /F1 8 Tf 0.36 0.38 0.44 rg ${this.margin} ${fy} Td (${esc(this.footer)}) Tj ET`);
      const label = `Page ${i + 1} of ${total}`;
      p.push(`BT /F1 8 Tf 0.36 0.38 0.44 rg ${(A4.width - this.margin - textWidth(label, 8)).toFixed(2)} ${fy} Td (${esc(label)}) Tj ET`);
    });
    const objs: string[] = [];
    const add = (body: string) => { objs.push(body); return objs.length; };
    const catalog = add("");
    const pagesObj = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const p of this.pages) {
      const stream = p.join("\n");
      const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${esc(meta.title)}) /Producer (Housy) ${meta.author ? `/Author (${esc(meta.author)}) ` : ""}>>`);
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, "latin1"));
  }
}
