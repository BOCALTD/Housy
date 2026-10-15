import { getMember, requireUser } from "./auth";
import { asCompany, asPerson, type Actor } from "./services/collab";

/** Who is acting and which area they are in: company members work under /app, everyone else under /me. */
export async function currentActor(): Promise<{ actor: Actor; base: string }> {
  const m = await getMember();
  if (m) return { actor: asCompany(m), base: "/app/collaborations" };
  const u = await requireUser();
  return { actor: asPerson(u.id), base: "/me/collaborations" };
}
