import { optOutBulk } from "@/lib/services/bulk-messaging";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe (RFC 8058): mail programs post here from the List-Unsubscribe header. The signed token in the address is
 * the only key; it names one company and one email address.
 */
export async function POST(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  try {
    await optOutBulk(t);
    return new Response("Unsubscribed", { status: 200 });
  } catch {
    return new Response("This link is not valid", { status: 400 });
  }
}
