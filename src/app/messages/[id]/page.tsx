import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { getConversation } from "@/lib/services/messaging";
import { avatarsFor } from "@/lib/services/avatars";
import { chatMessage } from "@/lib/chat-shape";
import { Field, sp, type SP } from "@/components/ui";
import { ChatThread } from "@/components/ChatThread";
import { myFlatmateActivity, myRooms, roomForConversation } from "@/lib/services/flatmates";
import { addToRoomAction, leaveRoomAction } from "../../flatmates/actions";
import { blockAction, cardAction, inspectAction, inspectReplyAction, reportAction, unblockAction } from "../actions";
import { sendChatAction } from "../live-actions";

export const metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

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
  const avatars = await avatarsFor(t.others.map((o) => o.userId)).catch(() => new Map<string, string>());
  const title = t.others.map((o) => o.name).join(", ") || "Chat";
  const initials = title.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  // Answers and report buttons for particular messages, drawn on the server and placed inside their bubbles.
  const extras: Record<string, React.ReactNode> = {};
  for (const m of t.messages) {
    const mine = m.senderId === me.id;
    if (m.kind === "INSPECTION_REQUEST") {
      extras[m.id] = t.answered.has(m.id) ? <p className="bubble-note">{t.answered.get(m.id) === "accept" ? "Accepted" : "Declined"}</p> : mine ? <p className="bubble-note">Waiting for an answer</p> : (
        <form action={inspectReplyAction} className="bubble-actions">{hid}<input type="hidden" name="requestId" value={m.id} />
          <button className="btn primary small" type="submit" name="decision" value="accept">Accept</button><button className="btn small" type="submit" name="decision" value="decline" data-confirm="Decline this?" data-confirm-body="The person is told." data-confirm-ok="Decline" data-confirm-tone="default">Decline</button></form>
      );
    }
    if (!mine && !t.reported.has(m.id)) {
      extras[m.id] = <>{extras[m.id]}<details className="bubble-report"><summary>Report</summary><form action={reportAction} className="row">{hid}<input type="hidden" name="messageId" value={m.id} /><input name="reason" required minLength={3} placeholder="What is wrong" aria-label="What is wrong" /><button className="btn small" type="submit">Send</button></form></details></>;
    }
  }

  return (
    <div className="chat-pane">
      <header className="chat-head">
        <Link href="/messages" className="chat-back" aria-label="All chats">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </Link>
        <span className="avatar">{other && avatars.get(other.userId) ? <img src={avatars.get(other.userId)} alt="" /> : initials}</span>
        <div className="chat-head-text">
          <h1 className="chat-title">{title}</h1>
          <span>{room ? `Flatmate room${roomInfo ? ` · ${roomInfo.members.length} people` : ""}` : t.conversation.subject || "Private chat"}</span>
        </div>
        <details className="chat-menu">
          <summary aria-label="More">⋮</summary>
          <div className="chat-menu-panel">
            {!t.cannotReply ? (
              <>
                <details><summary>Share a property</summary>
                  <form action={cardAction} className="stack">{hid}<Field label="Listing reference"><input name="listingRef" required /></Field><Field label="Note (optional)"><input name="note" maxLength={500} /></Field><button className="btn primary" type="submit">Share</button></form></details>
                <details><summary>Arrange an inspection</summary>
                  <form action={inspectAction} className="stack">{hid}
                    <div className="fields"><Field label="Date"><input type="date" name="date" required /></Field><Field label="Time"><input type="time" name="time" required /></Field></div>
                    <Field label="Listing reference (optional)"><input name="listingRef" /></Field>
                    <Field label="Note (optional)"><input name="note" maxLength={500} /></Field><button className="btn primary" type="submit">Send request</button></form></details>
              </>
            ) : null}
            {room && room.status === "OPEN" && canAdd.length ? (
              <details><summary>Add a matched flatmate</summary>
                <form action={addToRoomAction} className="stack"><input type="hidden" name="roomId" value={room.id} /><input type="hidden" name="conversationId" value={params.id} />
                  <select name="userId" aria-label="Matched flatmate to add">{canAdd.map((m) => <option key={m.other} value={m.other}>{m.name} ({m.score}%)</option>)}</select>
                  <button className="btn" type="submit">Add</button></form></details>
            ) : null}
            {room && room.status === "OPEN" ? (
              <details><summary>Leave this room</summary>
                <form action={leaveRoomAction} className="stack"><input type="hidden" name="roomId" value={room.id} /><input type="hidden" name="conversationId" value={params.id} /><p className="small muted">You will stop seeing new messages. A room with fewer than two people closes.</p><button className="btn danger" type="submit" data-confirm="Leave this room?" data-confirm-body="You will stop getting its messages." data-confirm-ok="Leave room">Leave room</button></form></details>
            ) : null}
            {other ? (t.iBlocked ? (
              <form action={unblockAction}>{hid}<input type="hidden" name="userId" value={other.userId} /><button className="btn" type="submit">Unblock {other.name}</button></form>
            ) : (
              <details><summary>Block {other.name}</summary><form action={blockAction} className="stack">{hid}<input type="hidden" name="userId" value={other.userId} /><p className="small muted">They will not be able to message you, and you will not be able to message them. They are not told.</p><button className="btn danger" type="submit" data-confirm="Block this person?" data-confirm-body="They can no longer message you." data-confirm-ok="Block">Block</button></form></details>
            )) : null}
          </div>
        </details>
      </header>
      {t.olderFrom ? <Link className="chat-older" href={`/messages/${params.id}?before=${encodeURIComponent(t.olderFrom.toISOString())}`}>Load earlier messages</Link> : null}
      <ChatThread conversationId={params.id} meId={me.id} initial={t.messages.map(chatMessage)} initialSeen={t.seenUpTo?.toISOString() ?? null}
        canReply={!t.cannotReply} send={sendChatAction} extras={extras} />
      {t.cannotReply ? <p className="chat-cant">{t.iBlocked ? "You blocked this person." : room && room.status !== "OPEN" ? "This chat room is closed." : "You cannot reply to this conversation."}</p> : null}
    </div>
  );
}
