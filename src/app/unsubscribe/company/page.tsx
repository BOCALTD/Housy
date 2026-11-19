import { readOptOutLink } from "@/lib/services/bulk-messaging";
import { sp, type SP } from "@/components/ui";
import { companyOptOutAction } from "./actions";

export const metadata = { title: "Stop messages", robots: { index: false } };
export const dynamic = "force-dynamic";

/** From the link at the bottom of a company's bulk email: stop that company's messages to this address. */
export default async function CompanyUnsubscribePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const t = sp(searchParams, "t") ?? "";
  const done = sp(searchParams, "done") === "1";
  const link = t ? await readOptOutLink(t) : null;
  return (
    <div className="stack-lg" style={{ maxWidth: 520 }}>
      <h1>Stop messages</h1>
      {!link ? <div className="card"><p>This link is not valid. Reply to the company&apos;s email and ask them to stop writing to you.</p></div>
        : done ? <div className="card"><p>Done. {link.company} will not send messages like this to {link.email} again.</p></div>
        : (
          <form action={companyOptOutAction} className="card stack">
            <input type="hidden" name="t" value={t} />
            <p>Stop messages from <strong>{link.company}</strong> to {link.email}?</p>
            <p className="small muted">This stops their bulk messages only. Anything about a tenancy or a deal you are part of may still reach you directly.</p>
            <button className="btn primary" type="submit">Yes, stop their messages</button>
          </form>
        )}
    </div>
  );
}
