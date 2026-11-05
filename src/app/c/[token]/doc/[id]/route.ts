import { clientLinkDocument } from "@/lib/services/client-files";

export const dynamic = "force-dynamic";

/** A document shared through a client link. The secret in the link is the key; only that property's documents, only while the link is open. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const d = await clientLinkDocument(token, id).catch(() => null);
  if (!d) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(d.bytes), {
    headers: {
      "content-type": d.type || "application/octet-stream",
      "content-disposition": `attachment; filename="${d.name.replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    },
  });
}
