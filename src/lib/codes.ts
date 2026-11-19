/**
 * Printable codes for inventory labels, drawn on the server as SVG (no images to fetch, sharp at any print size):
 *  - a QR code holding the item's scan address, so any phone camera opens the item (after signing in);
 *  - a Code 128 barcode holding the item's code, which a hardware barcode scanner types into the "Find an item" box.
 */
import bwip from "bwip-js/node";

/** Code 128 carries printable ASCII only; codes outside that get the QR code alone. */
export const barcodeable = (code: string) => /^[\x20-\x7e]{1,48}$/.test(code);

const clean = (svg: string) => svg.replace(/<\?xml[^>]*>\s*/, "").replace("<svg ", '<svg preserveAspectRatio="xMidYMid meet" ');

export function qrSvg(text: string): string {
  return clean(bwip.toSVG({ bcid: "qrcode", text, paddingwidth: 0, paddingheight: 0, ...({ eclevel: "M" } as object) }));
}

export function barcodeSvg(code: string): string | null {
  if (!barcodeable(code)) return null;
  return clean(bwip.toSVG({ bcid: "code128", text: code, height: 9, includetext: false, paddingwidth: 2 }));
}

/** The address a label's QR code opens. */
export const scanPath = (code: string) => `/scan?code=${encodeURIComponent(code)}`;
