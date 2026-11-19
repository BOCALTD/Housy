import { redirect } from "next/navigation";
import { getSession, requireMember } from "@/lib/auth";
import { findItemByCode } from "@/lib/services/inventory";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "Scanned label" };

/**
 * Where a label's QR code leads. Signed in to the item's workspace, it opens the item; otherwise it asks the person to sign in
 * and comes back here.
 */
export default async function ScanPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const code = (sp(await searchP, "code") ?? "").trim().slice(0, 100);
  const here = `/scan?code=${encodeURIComponent(code)}`;
  if (!(await getSession())) redirect(`/login?next=${encodeURIComponent(here)}`);
  const member = await requireMember("asset.view");
  if (!code) redirect(`/app/inventory?error=${encodeURIComponent("That label has no code. Type the code printed under it.")}`);
  const item = await findItemByCode(member, code);
  if (!item) redirect(`/app/inventory?error=${encodeURIComponent(`No item in ${member.companyName} has the code "${code}". If it belongs to another workspace, switch to it and scan again.`)}`);
  redirect(`/app/inventory/${item.id}`);
}
