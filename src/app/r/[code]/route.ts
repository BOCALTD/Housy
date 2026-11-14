import { secureCookies } from "@/lib/cookie-security";
import { NextResponse } from "next/server";
import { codeOwner, countClick } from "@/lib/services/referrals";
import { sharedLinkOpened } from "@/lib/services/reels";
import { getSession } from "@/lib/auth";
import { isBot } from "@/lib/ad-rules";
import { isCodeShape } from "@/lib/reward-rules";
import { landingPath, shareablePath } from "@/lib/share-rules";

export const dynamic = "force-dynamic";

/** A referral link (also used by shared pages). It counts a real visit, remembers the code for 30 days in a first-party cookie, and sends the visitor to sign up. No consent is assumed for anything beyond that one code. */
export async function GET(req: Request, { params: paramsP }: { params: Promise<{ code: string }> }) {
  const params = await paramsP;
  const code = params.code.toUpperCase();
  const q = new URL(req.url).searchParams;
  // A shared property, reel or profile carries the sharer's code and opens that page; a plain invite opens sign-up.
  const shared = shareablePath(q.get("to"));
  const to = new URL(shared ? landingPath(shared) : q.get("for") === "company" ? "/join?as=company" : "/join", req.url);
  const res = NextResponse.redirect(to, 302);
  // Only a real person counts: not a chat app's link preview (it fetches the link the moment it is pasted) and not the
  // sharer opening their own link. A real person opening a shared reel is also what makes it a share.
  if (!isCodeShape(code) || isBot(req.headers.get("user-agent"))) return res;
  const owner = await codeOwner(code);
  const visitor = (await getSession().catch(() => null))?.user.id ?? null;
  if (!owner || owner === visitor) return res;
  const reel = shared ? /^\/reels\/([0-9a-f-]{36})$/.exec(shared)?.[1] : undefined;
  if (reel) await sharedLinkOpened(owner, reel, visitor);
  if (await countClick(code)) {
    const choice = /(?:^|;\s*)cookie_choice=([a-z]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
    if (choice === "all") {
      res.cookies.set("ref", `${code}.${Date.now()}`, { path: "/", maxAge: 30 * 864e2, httpOnly: true, sameSite: "lax", secure: await secureCookies() });
    } else if (choice !== "essential") {
      // No choice made yet: the code travels in the address, and is remembered only if they then choose "Accept all".
      const u = new URL(res.headers.get("location") ?? to, req.url);
      u.searchParams.set("via", code);
      return NextResponse.redirect(u, 302);
    }
  }
  return res;
}
