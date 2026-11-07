import { getMember, getSession } from "./auth";
import { ROLE_LABELS } from "./permissions";

/** Who is signed in, in words, and where their own account starts: for the "leave your account?" screen. */
export async function signedInAs() {
  const session = await getSession();
  if (!session) return null;
  const member = session.companyId ? await getMember().catch(() => null) : null;
  return {
    name: session.user.name,
    isAdmin: session.user.isPlatformAdmin,
    role: member ? `${ROLE_LABELS[member.role]} at ${member.companyName}` : session.user.isPlatformAdmin ? "platform administrator" : "personal account",
    home: member ? "/app" : session.user.isPlatformAdmin ? "/admin" : "/me",
  };
}
