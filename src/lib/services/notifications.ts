import { withUser, type Tx } from "../db";
import { categoryOf, dedupeKeyFor } from "../notification-rules";

export interface NoticeInput {
  kind: string; title: string; body?: string; link?: string;
  /** false keeps the notice in the app only. */
  email?: boolean;
  /** An email template and its values. Without one, the title, body and link are used. */
  template?: string; vars?: Record<string, unknown>;
  /** Same key, same person: one email. Without one, the same kind and link on the same day count as one. */
  dedupeKey?: string;
}

/**
 * Leave an in-app notice for a person, and queue an email for it. Whether the email is really sent is decided later, when the queue
 * is processed: the person's settings, quiet hours, daily limit and the provider all come into it. Nothing goes to a phone.
 */
export async function notify(tx: Tx, userId: string, n: NoticeInput) {
  const title = n.title.slice(0, 160), body = (n.body ?? "").slice(0, 600), link = n.link ?? "";
  await tx.notification.createMany({ data: [{ userId, kind: n.kind, title, body, link }] });
  if (n.email === false) return;
  await enqueueEmail(tx, userId, { kind: n.kind, template: n.template, vars: { title, body, link, ...(n.vars ?? {}) }, ref: link || title, dedupeKey: n.dedupeKey });
}

/** Queue an email without an in-app notice (for example a welcome message). The same event on the same day is queued once. */
export async function enqueueEmail(tx: Pick<Tx, "emailOutbox" | "notificationLog">, userId: string, e: { kind: string; template?: string; vars: Record<string, unknown>; ref?: string; dedupeKey?: string }) {
  const queued = await tx.emailOutbox.createMany({
    data: [{ userId, kind: e.kind, category: categoryOf(e.kind), template: e.template ?? "generic", vars: e.vars as never, dedupeKey: dedupeKeyFor(userId, e.kind, e.ref ?? "", new Date(), e.dedupeKey) }],
    skipDuplicates: true,
  });
  if (queued.count === 0) await tx.notificationLog.createMany({ data: [{ userId, kind: e.kind, outcome: "DEDUPED" }] });
  return queued.count === 1;
}

export async function unreadCount(userId: string): Promise<number> {
  return withUser(userId, (tx) => tx.notification.count({ where: { userId, readAt: null } }));
}

export async function myNotifications(userId: string, take = 100) {
  return withUser(userId, (tx) => tx.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take }));
}

/** Tick one notice off, or all of them. */
export async function markRead(userId: string, id: string | null) {
  await withUser(userId, (tx) => tx.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } }));
}
