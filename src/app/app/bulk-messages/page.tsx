import { requireMember } from "@/lib/auth";
import { bulkOverview } from "@/lib/services/bulk-messaging";
import { BODY_MAX, SUBJECT_MAX } from "@/lib/bulk-rules";
import { formatDateTime } from "@/lib/dates";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { UpgradeNudge } from "@/components/Upgrades";
import { cancelBulkAction, sendBulkAction } from "./actions";

export const metadata = { title: "Bulk messages" };
export const dynamic = "force-dynamic";

const n = (x: number) => x.toLocaleString("en-NG");

export default async function BulkMessagesPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("message.bulk");
  const d = await bulkOverview(member);
  const left = Math.max(0, d.allowance.monthly - d.used);
  const groups = [
    { key: "CLIENTS" as const, label: "Clients who agreed to marketing", g: d.groups.CLIENTS, why: "Only clients marked as having agreed to marketing messages, with an email address." },
    { key: "TENANTS" as const, label: "Tenants of current leases", g: d.groups.TENANTS, why: "Occupants of active leases whose contact details include an email address." },
  ];
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Bulk messages</h1>
        <p className="muted">Write once and email each of your clients or tenants separately. Every email carries a link to stop your messages, and anyone who uses it is left out from then on.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {!d.allowance.allowed ? (
        <UpgradeNudge feature="BULK_MESSAGING" audience="COMPANY" from="app" what="email all your clients or tenants at once" planName={d.allowance.planName} />
      ) : (
        <>
          <section className="card stack" aria-labelledby="allow-h">
            <h2 id="allow-h">This month</h2>
            <div className="fields">
              <div><div className="small muted">Recipients left</div><strong className="num" style={{ fontSize: 22 }}>{n(left)}</strong> <span className="small muted">of {n(d.allowance.monthly)}</span></div>
              <div><div className="small muted">Sends today</div><strong className="num" style={{ fontSize: 22 }}>{d.sendsToday}</strong> <span className="small muted">of {d.sendsPerDay}</span></div>
            </div>
            {!d.emailConnected ? <p className="flash warn" role="status">Email is not connected on this platform yet. Messages you send now wait in the queue and go out once it is.</p> : null}
          </section>

          <section className="card stack" aria-labelledby="new-h">
            <h2 id="new-h">New message</h2>
            <form action={sendBulkAction} className="stack">
              <fieldset className="field"><legend>Send to</legend>
                <div className="stack" style={{ gap: 8 }}>
                  {groups.map(({ key, label, g, why }, i) => (
                    <label key={key} className="check" style={{ alignItems: "flex-start" }}>
                      <input type="radio" name="audience" value={key} defaultChecked={i === 0} required />
                      <span><strong>{label}</strong>: {n(g.send.length)} {g.send.length === 1 ? "person" : "people"}
                        <span className="small muted" style={{ display: "block" }}>{why}{g.noEmail ? ` ${n(g.noEmail)} have no email address.` : ""}{g.optedOut ? ` ${n(g.optedOut)} asked to stop your messages.` : ""}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {d.assets.length ? (
                <Field label="Tenants of one property only (optional)" hint="Only used when sending to tenants.">
                  <select name="assetId" defaultValue=""><option value="">All properties</option>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select>
                </Field>
              ) : null}
              <Field label="Subject"><input name="subject" required minLength={3} maxLength={SUBJECT_MAX} placeholder="Water supply off on Saturday morning" /></Field>
              <Field label="Message" hint={`Plain text, up to ${n(BODY_MAX)} characters. Leave a blank line between paragraphs. Each email starts with the person's name.`}><textarea name="body" required minLength={10} maxLength={BODY_MAX} rows={8} /></Field>
              <p className="small muted">Replies go to your company&apos;s contact email. Your company name appears at the top of the email and in the subject.</p>
              <div><button className="btn primary" type="submit" data-confirm="Send this message now?" data-confirm-body="Each person in the group gets their own email over the next few minutes. You can stop it while it is still sending." data-confirm-ok="Send" data-confirm-tone="default">Send</button></div>
            </form>
          </section>
        </>
      )}

      <section className="card stack" aria-labelledby="hist-h">
        <h2 id="hist-h">Sent ({d.history.length})</h2>
        {d.history.length === 0 ? <p className="muted">Nothing sent yet.</p> : (
          <ShowMore noun="more messages" limit={5} items={d.history.map((h) => {
            const t = h.tally;
            const waiting = (t.QUEUED ?? 0) + (t.SENDING ?? 0) + (t.FAILED ?? 0);
            return (
              <li key={h.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
                <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}>
                  <div><strong>{h.subject}</strong> <span className="small muted">{h.audience === "CLIENTS" ? "Clients" : "Tenants"} · {formatDateTime(h.createdAt)} · <span className="mono">{h.ref}</span></span></div>
                  <Pill status={h.status === "SENT" ? "DONE" : h.status === "CANCELLED" ? "CANCELLED" : "PENDING"} label={h.status === "SENT" ? "Sent" : h.status === "CANCELLED" ? "Stopped" : "Sending"} />
                </div>
                <div className="small muted">{n(t.SENT ?? 0)} sent{waiting ? ` · ${n(waiting)} waiting` : ""}{t.SKIPPED ? ` · ${n(t.SKIPPED)} not sent (stopped or unsubscribed)` : ""}{t.DEAD ? ` · ${n(t.DEAD)} could not be delivered` : ""}</div>
                <details className="inline"><summary>Message</summary><p className="small" style={{ whiteSpace: "pre-line" }}>{h.body}</p></details>
                {h.status === "SENDING" ? (
                  <form action={cancelBulkAction}><input type="hidden" name="bulkId" value={h.id} /><button className="btn small" type="submit" data-confirm="Stop sending this message?" data-confirm-body="Emails already sent cannot be taken back. The rest are not sent." data-confirm-ok="Stop sending">Stop sending</button></form>
                ) : null}
              </div></li>
            );
          })} />
        )}
      </section>
    </div>
  );
}
