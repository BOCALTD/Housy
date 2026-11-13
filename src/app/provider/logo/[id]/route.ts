import { providerLogo } from "@/lib/services/verification-network";

/** A provider organisation's logo (public: it is shown with its name). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const l = await providerLogo(id).catch(() => null);
  if (!l) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(l.bytes), { headers: { "Content-Type": l.type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
