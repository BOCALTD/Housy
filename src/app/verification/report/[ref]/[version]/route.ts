import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { reportPdf } from "@/lib/services/verification-cases";

export const dynamic = "force-dynamic";

/** A verification report as a PDF, for the customer (released versions), the provider's staff and Housy's administrators. */
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string; version: string }> }) {
  const { ref, version } = await params;
  const session = await getSession();
  const v = Number(version);
  if (!session || !/^VR-[A-Z2-9]{10}$/.test(ref) || !Number.isInteger(v) || v < 1 || v > 999) return new Response("Not found", { status: 404 });
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const pdf = await reportPdf({ userId: session.user.id, isAdmin: session.user.isPlatformAdmin }, ref, v, base).catch((e) => { console.error(e); return null; });
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf.bytes), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.name}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}
