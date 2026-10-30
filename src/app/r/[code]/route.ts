import { NextResponse } from "next/server";
import { countClick } from "@/lib/services/referrals";
import { isCodeShape } from "@/lib/reward-rules";
import { landingPath, shareablePath } from "@/lib/share-rules";

export const dynamic = "force-dynamic";

/** A referral link (also used by shared pages). It counts the visit, remembers the code for 30 days in a first-party cookie, and sends the visitor to sign up. No consent is assumed for anything beyond that one code. */
export async function GET(req: Request, { params: paramsP }: { params: Promise<{ code: string }> }) {
  const params = await paramsP;
  const code = params.code.toUpperCase();
  const q = new URL(req.url).searchParams;
  // A shared property, reel or profile carries the sharer's code and opens that page; a plain invite opens sign-up.
  const shared = shareablePath(q.get("to"));
  const to = new URL(shared ? landingPath(shared) : q.get("for") === "company" ? "/join?as=company" : "/join", req.url);
  const res = NextResponse.redirect(to, 302);
  if (isCodeShape(code) && (await countClick(code))) {
    res.cookies.set("ref", `${code}.${Date.now()}`, { path: "/", maxAge: 30 * 864e2, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  return res;
}
