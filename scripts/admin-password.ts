/**
 * Set a new password for a platform administrator, from the server's own terminal (whoever can run this already controls
 * the server and its database, so it is the safe way back in when the staff password is lost).
 *   npm run admin:password                      (the administrator in SEED_ADMIN_EMAIL)
 *   npm run admin:password -- staff@example.com
 * The password is typed twice and never shown or saved anywhere but as a hash. Every session of that account is signed out,
 * a temporary sign-in lock is lifted (a ban is not), and the account holder gets a notice.
 */
import { createInterface } from "node:readline";
import { prisma, withUser } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-hash";
import { endTemporaryLock } from "../src/lib/services/login-guard";
import { notify } from "../src/lib/services/notifications";

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    if (hidden) out._writeToOutput = (s: string) => { if (s.includes(question)) out.output.write(s); else if (s === "\r\n" || s === "\n") out.output.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a); });
  });
}

async function main() {
  const email = (process.argv.slice(2).find((a) => a.includes("@")) ?? process.env.SEED_ADMIN_EMAIL ?? (await ask("Staff email: ", false))).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isPlatformAdmin) { console.error(`No administrator account uses ${email}.`); process.exit(1); }
  const pw = await ask("New password (at least 12 characters, not shown): ", true);
  if (pw.length < 12) { console.error("That is shorter than 12 characters. Nothing was changed."); process.exit(1); }
  if ((await ask("The same password again: ", true)) !== pw) { console.error("The two passwords do not match. Nothing was changed."); process.exit(1); }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } });
  const ended = await prisma.session.deleteMany({ where: { userId: user.id } });
  await endTemporaryLock(email);
  await withUser(user.id, (tx) => notify(tx, user.id, { kind: "security.password_changed", title: "Your staff password was changed from the server",
    body: "Someone with access to the server set a new password for this administrator account and signed out every device. If this was not you, tell the platform owner now.", link: "/me/security" })).catch(() => {});
  console.log(`Done. Sign in at /auth/login as ${email}. ${ended.count} open session${ended.count === 1 ? "" : "s"} signed out.`);
}

/** On Ubuntu under Windows the database does not start by itself after a restart. Try to start it; say what to run if not. */
async function databaseReady(): Promise<boolean> {
  const up = () => prisma.$queryRaw`select 1`.then(() => true, () => false);
  if (await up()) return true;
  console.log("The database is not running. Starting it (your Ubuntu password may be asked for)…");
  const { spawnSync } = await import("node:child_process");
  spawnSync("sudo", ["service", "postgresql", "start"], { stdio: "inherit" });
  for (let i = 0; i < 15; i++) { if (await up()) return true; await new Promise((r) => setTimeout(r, 1000)); }
  console.error("The database still is not running. Start it with:  sudo service postgresql start  then run this again.");
  return false;
}

databaseReady()
  .then((ok) => (ok ? main() : process.exit(1)))
  .catch((e) => { console.error(e instanceof Error ? e.message.split("\n").filter(Boolean).pop() : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
