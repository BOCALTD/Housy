import { NextResponse } from "next/server";

/** Send a generated PDF as a private download. */
export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new NextResponse(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
