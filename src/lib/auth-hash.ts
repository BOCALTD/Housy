import bcrypt from "bcryptjs";

// Kept separate from auth.ts (which depends on Next.js request APIs) so services and tests can use it.
export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
