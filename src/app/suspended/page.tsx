import Link from "next/link";
import { getMember, getSession } from "@/lib/auth";
import { workspaceClosure } from "@/lib/services/workspace-lifecycle";
import { formatDate } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";
import { resumeWorkspaceAction } from "./actions";

export const metadata = { title: "Workspace closed" };
export const dynamic = "force-dynamic";

export default async function SuspendedPage({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const session = await getSession();
  const c = session?.companyId ? await workspaceClosure(session.companyId) : null;
  const member = c ? await getMember() : null;
  const owner = member?.role === "COMPANY_SUPER_ADMIN";
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {!c ? (
        <>
          <h1>This workspace is open</h1>
          <section className="card"><p>Your selected company is not closed. <Link href="/app">Go to the workspace</Link>.</p></section>
        </>
      ) : c.kind === "PAUSED" ? (
        <>
          <h1>{c.name} is paused</h1>
          <section className="card stack">
            <p>The workspace was paused on {formatDate(c.at)}. Its listings and profiles are hidden and the team cannot work in it until it is resumed. Nothing has been deleted.</p>
            {c.reason && c.reason !== "Paused by the company" ? <p><strong>Note:</strong> {c.reason}</p> : null}
            {owner ? (
              <form action={resumeWorkspaceAction} className="row">
                <button className="btn primary" type="submit" data-confirm="Resume this workspace?" data-confirm-body="Your listings and profiles show again and your team is told." data-confirm-ok="Resume" data-confirm-tone="default">Resume workspace</button>
              </form>
            ) : <p className="small muted">Only the workspace&apos;s top administrator can resume it.</p>}
          </section>
        </>
      ) : c.kind === "CLOSED" ? (
        <>
          <h1>{c.name} is closed</h1>
          <section className="card stack">
            <p>The workspace was closed on {formatDate(c.at)}. Its records are kept as the law requires.</p>
            <p>To reopen it, <Link href="/support">contact support</Link>.</p>
          </section>
        </>
      ) : (
        <>
          <h1>This company&apos;s workspace is suspended</h1>
          <section className="card stack">
            <p>The platform suspended the company on {formatDate(c.at)}. Its listings and public profile are hidden, and its API keys do not work, until it is restored. No records have been deleted.</p>
            <p><strong>Reason given:</strong> {c.reason}</p>
            <p>To respond or appeal, <Link href="/trust?category=APPEAL&targetKind=COMPANY">use the Trust and Safety Centre</Link> or <Link href="/support">contact support</Link>.</p>
          </section>
        </>
      )}
      <p className="small"><Link href="/app/switch">Switch to another company</Link> · <Link href="/me">My account</Link></p>
    </div>
  );
}
