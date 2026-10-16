import { readUnsub } from "@/lib/notification-rules";
import { sp, type SP } from "@/components/ui";
import { unsubscribeAction } from "./actions";

export const metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

const WHAT = { ACTIVITY: "activity emails", ALERTS: "property alert emails", PROMOTIONAL: "promotional emails", ALL_OPTIONAL: "all optional emails" } as const;

export default async function UnsubscribePage({ searchParams }: { searchParams?: SP }) {
  const t = sp(searchParams, "t") ?? "";
  const done = sp(searchParams, "done");
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.APP_DB_PASSWORD || "development-only-secret";
  const link = readUnsub(secret, t);
  return (
    <div className="stack-lg" style={{ maxWidth: 520 }}>
      <h1>Unsubscribe</h1>
      {done ? <div className="card"><p>Done. You will no longer get {WHAT[done as keyof typeof WHAT] ?? "those emails"}. Security messages about your account still reach you. You can change this any time in your notification settings.</p></div>
        : !link ? <div className="card"><p>This link is not valid. Sign in and open your notification settings to change what you receive.</p></div>
        : <form action={unsubscribeAction} className="card stack"><input type="hidden" name="t" value={t} /><p>Stop {WHAT[link.scope]}?</p><button className="btn primary" type="submit">Yes, unsubscribe me</button></form>}
    </div>
  );
}
