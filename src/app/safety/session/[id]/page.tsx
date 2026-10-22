import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ownSession } from "@/lib/services/safety";
import { EMERGENCY_NUMBERS, PING_RETENTION_DAYS, sessionLive } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";
import { SafetyLive } from "@/components/SafetyLive";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "Safety session" };
export const dynamic = "force-dynamic";

export default async function SafetySessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const { id } = await params;
  const link = sp(await searchParams, "link");
  const user = await requireUser();
  const s = await ownSession(user.id, id);
  if (!s) notFound();
  const live = sessionLive(s);
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Safety session</p>
        <h1>{live ? "Your safety session is on" : "Safety session ended"}</h1>
        <p className="muted">Started {formatDateTime(s.startedAt)} · expected to end {formatDateTime(s.expectedEndAt)}{s.endedAt ? ` · ended ${formatDateTime(s.endedAt)}` : ""}. Location points are deleted {PING_RETENTION_DAYS} days after it ends.</p>
      </div>
      {link && live ? (
        <section className="card stack" aria-labelledby="share-h">
          <h2 id="share-h">Send this link to {s.trustedName || "your trusted contact"}</h2>
          <p className="small">Copy it into a text or WhatsApp message. It shows your status and last location only while the session is on, and stops working when it ends. This is the only time it is shown.</p>
          <code className="secret-box">{`${base}/safety/watch/${link}`}</code>
        </section>
      ) : null}
      <section className="card stack">
        {live ? <SafetyLive sessionId={s.id} checkedIn={!!s.checkedInAt} emergency={!!s.emergencyAt} numbers={EMERGENCY_NUMBERS} />
          : <p>Location sharing is off. {s.endReason === "AUTO_STOPPED" ? "It stopped by itself after the expected end time." : s.endReason === "CHECKED_OUT" ? "You checked out." : "You stopped it."}</p>}
      </section>
      <p className="small"><Link href="/me/inspections">My inspections</Link> · <Link href="/trust">Trust and Safety Centre</Link></p>
    </div>
  );
}
