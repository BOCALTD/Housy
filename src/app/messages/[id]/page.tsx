import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { getConversation } from "@/lib/services/messaging";
import { formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { myFlatmateActivity, myRooms, roomForConversation } from "@/lib/services/flatmates";
import { addToRoomAction, leaveRoomAction } from "../../flatmates/actions";
import { blockAction, cardAction, inspectAction, inspectReplyAction, reportAction, sendAction, unblockAction } from "../actions";

export const metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

const at = (d: Date) => `${formatDate(d)} ${d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}`;

export default async function ConversationPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const me = await requireUser();
  const { actor } = await currentActor();
  const before = sp(searchParams, "before");
  let t;
  try { t = await getConversation(actor, params.id, before ? new Date(before) : undefined); } catch { notFound(); }
  const hid = <input type="hidden" name="id" value={params.id} />;
  const room = await roomForConversation(me.id, params.id).catch(() => null);
  const roomInfo = room ? (await myRooms(me.id)).find((r) => r.id === room.id) ?? null : null;
  const canAdd = room && room.status === "OPEN" && roomInfo ? (await myFlatmateActivity(me.id)).matches.filter((m) => !roomInfo.members.some((x) => x.userId === m.other)) : [];
  const other = t.others[0];
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>{t.others.map((o) => o.name).join(", ")}</h1>
        <p className="muted">{t.conversation.subject ? `${t.conversation.subject} · ` : ""}<Link href="/messages">All messages</Link></p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {room ? (
        <section className="card stack fm-roombar" aria-label="Flatmate chat room">
          <div className="row between"><strong>Flatmate chat room{roomInfo ? ` · ${roomInfo.members.length} people` : ""}</strong>{room.status !== "OPEN" ? <span className="pill bad">Closed</span> : null}</div>
          <p className="small muted">Plan viewings and share listings here. Meet somewhere public first, and never pay before you have seen the room and met the landlord or agent.</p>
          {room.status === "OPEN" ? (
            <div className="row">
              {canAdd.length ? (
                <details className="inline"><summary>Add a matched flatmate</summary>
                  <form action={addToRoomAction} className="row"><input type="hidden" name="roomId" value={room.id} /><input type="hidden" name="conversationId" value={params.id} />
                    <select name="userId" aria-label="Matched flatmate to add">{canAdd.map((m) => <option key={m.other} value={m.other}>{m.name} ({m.score}%)</option>)}</select>
                    <button className="btn" type="submit">Add</button></form>
                </details>
              ) : null}
              <details className="inline"><summary>Leave this room</summary>
                <form action={leaveRoomAction} className="stack"><input type="hidden" name="roomId" value={room.id} /><input type="hidden" name="conversationId" value={params.id} /><p className="small muted">You will stop seeing new messages. A room with fewer than two people closes.</p><button className="btn danger" type="submit">Leave room</button></form>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="card stack" aria-label="Messages">
        {t.olderFrom ? <Link className="btn" href={`/messages/${params.id}?before=${encodeURIComponent(t.olderFrom.toISOString())}`}>Earlier messages</Link> : null}
        {t.messages.length === 0 ? <p className="muted">No messages.</p> : (
          <ul className="timeline">{t.messages.map((m) => {
            const mine = m.senderId === me.id;
            const d = m.details as Record<string, string | number | null>;
            return (
              <li key={m.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
                <div className="small muted"><strong>{mine ? "You" : m.senderName}</strong> · {at(m.createdAt)}</div>
                {m.kind === "PROPERTY" ? (
                  <div className="card" style={{ padding: 12 }}><strong>{String(d.title)}</strong>
                    <div className="small muted">{[d.city, d.state].filter(Boolean).join(", ")}{d.purpose ? ` · ${humanize(String(d.purpose))}` : ""}{d.bedrooms ? ` · ${d.bedrooms} bed` : ""}{d.priceKobo ? ` · ${formatKobo(BigInt(String(d.priceKobo)))}` : ""}</div>
                    <Link href={`/properties/${d.publicRef}`}>View the listing</Link></div>
                ) : null}
                {m.kind === "INSPECTION_REQUEST" ? (
                  <div className="card" style={{ padding: 12 }}><strong>Inspection request</strong>
                    <div className="small">{d.title ? `${d.title} · ` : ""}{String(d.date)} at {String(d.time)}</div>
                    {t.answered.has(m.id) ? <div className="small muted">{humanize(t.answered.get(m.id)!)}</div> : mine ? <div className="small muted">Waiting for an answer</div> : (
                      <details className="inline"><summary>Answer</summary>
                        <form action={inspectReplyAction} className="stack">{hid}<input type="hidden" name="requestId" value={m.id} /><Field label="Note (optional)"><input name="note" maxLength={500} /></Field>
                          <div className="row"><button className="btn primary" type="submit" name="decision" value="accept">Accept</button><button className="btn" type="submit" name="decision" value="decline">Decline</button></div></form></details>
                    )}
                  </div>
                ) : null}
                {m.kind === "INSPECTION_REPLY" ? <div className="small"><strong>{humanize(String(d.decision))}</strong> the inspection request</div> : null}
                {m.body ? <div>{m.body}</div> : null}
                {m.masked ? <div className="small muted">Contact details were hidden because the sender&apos;s plan does not include sharing them.</div> : null}
                {!mine ? (
                  t.reported.has(m.id) ? <div className="small muted">You reported this.</div> : (
                    <details className="inline"><summary>Report</summary>
                      <form action={reportAction} className="row">{hid}<input type="hidden" name="messageId" value={m.id} /><input name="reason" required minLength={3} placeholder="What is wrong" aria-label="What is wrong" /><button className="btn" type="submit">Report</button></form></details>
                  )
                ) : null}
              </div></li>
            );
          })}</ul>
        )}
        {t.seenUpTo && t.messages.some((m) => m.senderId === me.id && m.createdAt <= t.seenUpTo!) ? <p className="small muted">Seen {at(t.seenUpTo)}</p> : null}
      </section>

      {t.cannotReply ? <p className="muted">{t.iBlocked ? "You blocked this person." : "You cannot reply to this conversation."}</p> : (
        <section className="card stack">
          <form action={sendAction} className="stack">{hid}<Field label="Reply"><textarea name="body" rows={3} required maxLength={4000} /></Field><button className="btn primary" type="submit">Send</button></form>
          <details className="inline"><summary>Share a property</summary>
            <form action={cardAction} className="stack">{hid}<Field label="Listing reference"><input name="listingRef" required /></Field><Field label="Note (optional)"><input name="note" maxLength={500} /></Field><button className="btn" type="submit">Share</button></form></details>
          <details className="inline"><summary>Ask to arrange an inspection</summary>
            <form action={inspectAction} className="stack">{hid}
              <div className="fields"><Field label="Date"><input type="date" name="date" required /></Field><Field label="Time"><input type="time" name="time" required /></Field><Field label="Listing reference (optional)"><input name="listingRef" /></Field></div>
              <Field label="Note (optional)"><input name="note" maxLength={500} /></Field><button className="btn" type="submit">Send request</button></form></details>
        </section>
      )}
      {other ? (
        <section className="card">
          {t.iBlocked ? <form action={unblockAction}>{hid}<input type="hidden" name="userId" value={other.userId} /><button className="btn" type="submit">Unblock {other.name}</button></form> : (
            <details className="inline"><summary>Block {other.name}</summary><form action={blockAction} className="stack">{hid}<input type="hidden" name="userId" value={other.userId} /><p className="small muted">They will not be able to message you, and you will not be able to message them. They are not told.</p><button className="btn" type="submit">Block</button></form></details>
          )}
        </section>
      ) : null}
    </div>
  );
}
