import { getSession } from "@/lib/auth";
import { caseFile } from "@/lib/services/verification-cases";

export const dynamic = "force-dynamic";

/** A document or piece of evidence on a verification case: row-level security decides who may open it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const f = await caseFile(session.user.id, id, session.user.isPlatformAdmin).catch(() => null);
  if (!f) return new Response("Not found", { status: 404 });
  const inline = f.type === "application/pdf" || f.type.startsWith("image/");
  return new Response(new Uint8Array(f.bytes), { headers: {
    "Content-Type": f.type, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^\w.\- ]/g, "_")}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  } });
}
