import Link from "next/link";
import { getSession } from "@/lib/auth";
import { companySuspension } from "@/lib/services/governance";

export const metadata = { title: "Workspace suspended" };
export const dynamic = "force-dynamic";

export default async function SuspendedPage() {
  const session = await getSession();
  const s = session?.companyId ? await companySuspension(session.companyId) : null;
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <h1>This company&apos;s workspace is suspended</h1>
      {s ? (
        <section className="card stack">
          <p>The platform suspended the company on {s.at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Its listings and public profile are hidden, and its API keys do not work, until it is restored. No records have been deleted.</p>
          <p><strong>Reason given:</strong> {s.reason}</p>
          <p>To respond or appeal, <Link href="/trust?category=APPEAL&targetKind=COMPANY">use the Trust and Safety Centre</Link> or <Link href="/support">contact support</Link>.</p>
        </section>
      ) : <section className="card"><p>Your selected company is not suspended. <Link href="/app">Go to the workspace</Link>.</p></section>}
      <p className="small"><Link href="/app/switch">Switch to another company</Link> · <Link href="/me">My account</Link></p>
    </div>
  );
}
