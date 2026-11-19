import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { barcodeSvg, qrSvg, scanPath, svgImage } from "@/lib/codes";
import { labelItems } from "@/lib/services/inventory";
import { Field, sp, type SP } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Inventory labels" };

const SIZES = {
  standard: { label: "Standard: 63.5 × 38.1 mm, 21 on an A4 sheet", perSheet: 21 },
  small: { label: "Small: 38.1 × 21.2 mm, 65 on an A4 sheet", perSheet: 65 },
} as const;
type Size = keyof typeof SIZES;

/**
 * A sheet of labels to print on standard A4 label paper: each with a QR code that any phone camera opens, and a barcode of the
 * item's code for a hardware scanner. Only the labels print; the controls above them do not.
 */
export default async function LabelsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const ids = (sp(searchParams, "ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const assetId = sp(searchParams, "assetId") || undefined;
  const size: Size = sp(searchParams, "size") === "small" ? "small" : "standard";
  const page = Number(sp(searchParams, "page") ?? "1") || 1;
  const d = await labelItems(member, { ids, assetId, page });
  const origin = await siteOrigin();
  const link = (p: number) => `/app/inventory/labels?${new URLSearchParams({ ...(assetId ? { assetId } : {}), size, page: String(p) })}`;
  return (
    <div className="stack-lg">
      <div className="stack no-print" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/inventory">All inventory</Link></p>
        <h1>Print labels</h1>
        <p className="muted">Print on A4 label paper at 100% scale (not &ldquo;fit to page&rdquo;). Scanning the QR code with a phone camera opens the item; a barcode scanner reads the barcode into the &ldquo;Find an item&rdquo; box.</p>
      </div>

      <section className="card stack no-print" aria-label="Label options">
        <form method="get" className="stack">
          {ids.length ? <input type="hidden" name="ids" value={ids.join(",")} /> : null}
          <div className="fields">
            {!ids.length ? (
              <Field label="Items"><select name="assetId" defaultValue={assetId ?? ""}><option value="">Every item in use</option>{d.assets.map((a) => <option key={a.id} value={a.id}>On {a.ref} · {a.name}</option>)}</select></Field>
            ) : null}
            <Field label="Label size"><select name="size" defaultValue={size}>{(Object.keys(SIZES) as Size[]).map((k) => <option key={k} value={k}>{SIZES[k].label}</option>)}</select></Field>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button className="btn" type="submit">Show labels</button>
            {d.items.length ? <PrintButton label={`Print ${d.items.length} ${d.items.length === 1 ? "label" : "labels"}`} /> : null}
            {ids.length ? <Link className="btn" href="/app/inventory/labels">Choose other items</Link> : null}
          </div>
        </form>
        {!ids.length && d.pages > 1 ? (
          <nav className="row" aria-label="Label pages" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="small muted">{d.total} items · labels {(d.page - 1) * 63 + 1}–{Math.min(d.page * 63, d.total)}</span>
            {d.page > 1 ? <Link className="btn small" href={link(d.page - 1)}>Previous</Link> : null}
            {d.page < d.pages ? <Link className="btn small" href={link(d.page + 1)}>Next {Math.min(63, d.total - d.page * 63)}</Link> : null}
          </nav>
        ) : null}
      </section>

      {d.items.length === 0 ? <p className="muted no-print">No items in use to label. Disposed items are left out.</p> : (
        <div className={`label-sheet print-area ${size}`} aria-label="Labels">
          {d.items.map((i) => {
            const bar = size === "standard" ? barcodeSvg(i.code) : null;
            return (
              <div key={i.id} className="inv-label">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="inv-qr" alt={`QR code for ${i.code}`} src={svgImage(qrSvg(`${origin}${scanPath(i.code)}`))} />
                <div className="inv-text">
                  <strong className="inv-name">{i.name}</strong>
                  <span className="mono inv-no">{i.code}</span>
                  {size === "standard" ? <span className="inv-meta">{[member.companyName, i.asset?.ref, i.location].filter(Boolean).join(" · ")}</span> : null}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {bar ? <img className="inv-bar" alt={`Barcode ${i.code}`} src={svgImage(bar)} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
