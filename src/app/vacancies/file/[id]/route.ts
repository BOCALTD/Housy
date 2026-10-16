import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { vacancyPhoto } from "@/lib/services/vacancies";

export const dynamic = "force-dynamic";
/** A photograph is shown only to the person who took it and to the review team. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return new NextResponse("Sign in to view photographs.", { status: 401 });
  const f = await vacancyPhoto(s.user.id, params.id);
  if (!f) return new NextResponse("Not found.", { status: 404 });
  return new NextResponse(new Uint8Array(f.bytes), { headers: { "Content-Type": f.mimeType, "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" } });
}
