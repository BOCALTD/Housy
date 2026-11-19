import { NextResponse } from "next/server";
import { inboundConfig, receiveInbound, secretMatches } from "@/lib/services/inbound-email";

export const dynamic = "force-dynamic";

/**
 * Received emails, posted by the email provider (Postmark's inbound JSON). The provider must include Housy's secret, either as
 * ?key=... in the address or as the password of the address's sign-in (https://inbound:SECRET@your-site/api/inbound-email).
 * Answers 200 for anything handled (including emails for no company), so the provider does not retry them; 401 for a wrong secret.
 */
export async function POST(req: Request) {
  const { secret } = await inboundConfig();
  const url = new URL(req.url);
  const basic = (req.headers.get("authorization") ?? "").replace(/^Basic\s+/i, "");
  const fromBasic = basic ? Buffer.from(basic, "base64").toString().split(":").slice(1).join(":") : "";
  if (!secretMatches(url.searchParams.get("key") ?? fromBasic, secret)) return NextResponse.json({ error: "not allowed" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 30 * 1024 * 1024) return NextResponse.json({ status: "ignored", reason: "too large" });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ status: "ignored", reason: "not JSON" }); }
  try {
    return NextResponse.json(await receiveInbound(body));
  } catch {
    // Something on our side: let the provider try again later.
    return NextResponse.json({ error: "try again" }, { status: 503 });
  }
}
