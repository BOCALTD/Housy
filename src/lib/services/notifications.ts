import { withUser, type Tx } from "../db";

export interface NoticeInput { kind: string; title: string; body?: string; link?: string }

/** Leave an in-app notice for a person. Nothing is emailed or sent to a phone. */
export async function notify(tx: Tx, userId: string, n: NoticeInput) {
  await tx.notification.createMany({ data: [{ userId, kind: n.kind, title: n.title.slice(0, 160), body: (n.body ?? "").slice(0, 600), link: n.link ?? "" }] });
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
