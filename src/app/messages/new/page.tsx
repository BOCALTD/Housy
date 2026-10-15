import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { prisma } from "@/lib/db";
import { startAction } from "../actions";

export const metadata = { title: "New message" };
export const dynamic = "force-dynamic";

export default async function NewMessagePage({ searchParams }: { searchParams?: SP }) {
  const me = await requireUser();
  const to = sp(searchParams, "to");
  if (!to || to === me.id) redirect("/messages");
  const target = await prisma.user.findUnique({ where: { id: to }, select: { name: true } });
  if (!target) redirect("/messages");
  const collab = sp(searchParams, "collab");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Message {target.name}</h1><p className="muted"><Link href="/messages">Back to messages</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={startAction} className="card stack">
        <input type="hidden" name="toUserId" value={to} />{collab ? <input type="hidden" name="collaborationId" value={collab} /> : null}
        <Field label="Subject (optional)"><input name="subject" maxLength={160} /></Field>
        <Field label="Message" hint="Phone numbers and email addresses are hidden unless your plan includes them."><textarea name="body" rows={5} required maxLength={4000} /></Field>
        <button className="btn primary" type="submit">Send</button>
      </form>
    </div>
  );
}
