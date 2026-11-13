import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { startApplication } from "@/lib/services/verification-network";

export const dynamic = "force-dynamic";

/** Straight into an application (used after signing up): starts one, or carries on with the open one. */
export default async function Apply() {
  const session = await getSession();
  if (!session) redirect(`/join?next=${encodeURIComponent("/verification-partners/apply")}`);
  const ref = await startApplication(session.user.id);
  redirect(`/verification-partners/applications/${ref}?step=corporate`);
}
