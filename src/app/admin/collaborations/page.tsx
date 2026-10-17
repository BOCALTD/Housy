import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminCollaborations } from "@/lib/services/collab";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { platformResumeAction, platformSuspendAction } from "./actions";

export const metadata = { title: "Collaborations (platform)" };
export const dynamic = "force-dynamic";

export default async function AdminCollaborationsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const rows = await adminCollaborations(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Collaborations</h1><p className="muted">You can suspend a collaboration that breaks the rules. Only you can resume one you suspended. You see who is involved, not what they shared. <Link href="/admin">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">{rows.length === 0 ? <p className="muted">None yet.</p> : (
        <ShowMore noun="more" limit={8} items={rows.map((c) => (
          <li key={c.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
            <div className="row between"><div><strong>{c.title}</strong><div className="small muted">{c.ref} · {c.senderName} and {c.recipientName} · {formatDate(c.updatedAt)}</div></div><Pill status={c.status} label={humanize(c.status)} /></div>
            {c.status === "SUSPENDED" && c.suspendedBy === "PLATFORM" ? <form action={platformResumeAction}><input type="hidden" name="id" value={c.id} /><button className="btn" type="submit">Resume</button></form> : null}
            {c.status === "ACTIVE" ? (
              <details className="inline"><summary>Suspend</summary>
                <form action={platformSuspendAction} className="row"><input type="hidden" name="id" value={c.id} /><input name="reason" required minLength={3} placeholder="Reason" aria-label="Reason" /><button className="btn" type="submit">Suspend</button></form></details>
            ) : null}
          </div></li>))} />
      )}</section>
    </div>
  );
}
