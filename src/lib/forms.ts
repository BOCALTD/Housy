import { redirect } from "next/navigation";
import { ZodError } from "zod";
import "./zod-messages";
import { Prisma } from "@prisma/client";

export function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(form: FormData, name: string): string | undefined {
  const v = str(form, name);
  return v === "" ? undefined : v;
}

/** Turn any thrown error into a message a person can act on. */
export function messageFor(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => i.message).join(". ");
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return "That record already exists. Use a different value.";
    if (err.code === "P2025") return "That record was not found, or you do not have access to it.";
  }
  // Never show raw database errors to users.
  if (err instanceof Error && err.constructor.name.startsWith("PrismaClient")) return "Something went wrong. Try again.";
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}

/**
 * Run a server action body. On failure, return to `backTo` with the error shown on the page.
 * redirect() is called outside the try block so Next.js redirects are never swallowed.
 */
export async function act(backTo: string, body: () => Promise<string | void>): Promise<never> {
  let target: string;
  try {
    target = (await body()) ?? backTo;
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error(err);
    const sep = backTo.includes("?") ? "&" : "?";
    target = `${backTo}${sep}error=${encodeURIComponent(messageFor(err))}`;
  }
  redirect(target);
}

export function withNotice(path: string, notice: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}notice=${encodeURIComponent(notice)}`;
}

function isNextRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Return to a page with a warning toast (something worked, but needs attention). */
export function withWarning(path: string, warning: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}warning=${encodeURIComponent(warning)}`;
}
