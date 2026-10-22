// Push notifications to people's phones and computers. Devices are added by the person; messages are queued by notify()
// and sent by a job every minute. Nothing is sent until VAPID keys are configured.
import { withPlatformAdmin, withUser } from "../db";
import { makeSender, validSubscription, vapidFromEnv, type PushSender } from "../webpush";

const SYSTEM = "system";
const MAX_DEVICES = 10;
const MAX_ATTEMPTS = 5;
const KEEP_HOURS = 24;
const BATCH = 200;

export const pushPublicKey = () => vapidFromEnv()?.publicKey ?? null;

export async function myDevices(userId: string) {
  return withUser(userId, (tx) => tx.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, endpoint: true, label: true, createdAt: true, lastSuccessAt: true } }));
}

/** Save the subscription a browser handed over. The same browser subscribing again replaces its old record. */
export async function addDevice(userId: string, input: { endpoint: string; p256dh: string; auth: string; label: string }) {
  if (!validSubscription(input)) throw new Error("This browser's push details were not accepted");
  const label = input.label.trim().slice(0, 120);
  // The endpoint is unique across everyone: if this browser was signed in as someone else before, their record goes first.
  await withPlatformAdmin(SYSTEM, (tx) => tx.pushSubscription.deleteMany({ where: { endpoint: input.endpoint, userId: { not: userId } } }));
  await withUser(userId, async (tx) => {
    const count = await tx.pushSubscription.count({ where: { userId, endpoint: { not: input.endpoint } } });
    if (count >= MAX_DEVICES) throw new Error(`You can receive notifications on up to ${MAX_DEVICES} devices. Remove one first.`);
    await tx.pushSubscription.deleteMany({ where: { userId, endpoint: input.endpoint } });
    await tx.pushSubscription.create({ data: { userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, label } });
  });
}

export async function removeDevice(userId: string, idOrEndpoint: string) {
  await withUser(userId, (tx) => tx.pushSubscription.deleteMany({ where: { userId, OR: [{ id: idOrEndpoint }, { endpoint: idOrEndpoint }] } }));
}

/** Send what is waiting. Returns counts for the job log. */
export async function processPushQueue(sender: PushSender | null = null, now = new Date()) {
  const keys = vapidFromEnv();
  const send = sender ?? (keys ? makeSender(keys) : null);
  const stats = { sent: 0, failed: 0, dropped: 0, devicesRemoved: 0, configured: !!send };
  await withPlatformAdmin(SYSTEM, async (tx) => {
    // Old messages are not worth delivering late; messages for people with no device are never sent.
    await tx.pushOutbox.deleteMany({ where: { OR: [{ createdAt: { lt: new Date(now.getTime() - KEEP_HOURS * 3600_000) } }, { sentAt: { not: null }, createdAt: { lt: new Date(now.getTime() - 3600_000) } }, { attempts: { gte: MAX_ATTEMPTS } }] } });
  });
  if (!send) return stats;
  const due = await withPlatformAdmin(SYSTEM, (tx) => tx.pushOutbox.findMany({ where: { sentAt: null }, orderBy: { createdAt: "asc" }, take: BATCH }));
  if (due.length === 0) return stats;
  const devices = await withPlatformAdmin(SYSTEM, (tx) => tx.pushSubscription.findMany({ where: { userId: { in: [...new Set(due.map((d) => d.userId))] } } }));
  for (const m of due) {
    const mine = devices.filter((d) => d.userId === m.userId);
    if (mine.length === 0) { await withPlatformAdmin(SYSTEM, (tx) => tx.pushOutbox.delete({ where: { id: m.id } })); stats.dropped += 1; continue; }
    let delivered = false, retry = false;
    for (const d of mine) {
      try {
        const r = await send({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, { title: m.title, body: m.body, url: m.link.startsWith("/") ? m.link : "/me/notifications", tag: m.kind });
        if (r.status >= 200 && r.status < 300) {
          delivered = true;
          await withPlatformAdmin(SYSTEM, (tx) => tx.pushSubscription.update({ where: { id: d.id }, data: { lastSuccessAt: now, failures: 0 } }));
        } else if (r.status === 404 || r.status === 410) {
          await withPlatformAdmin(SYSTEM, (tx) => tx.pushSubscription.delete({ where: { id: d.id } }));
          stats.devicesRemoved += 1;
        } else {
          retry = true;
          const failures = d.failures + 1;
          await withPlatformAdmin(SYSTEM, (tx) => failures >= 20 ? tx.pushSubscription.delete({ where: { id: d.id } }) : tx.pushSubscription.update({ where: { id: d.id }, data: { failures } }));
        }
      } catch {
        retry = true;
      }
    }
    if (delivered || !retry) {
      await withPlatformAdmin(SYSTEM, (tx) => tx.pushOutbox.update({ where: { id: m.id }, data: { sentAt: now, attempts: { increment: 1 } } }));
      if (delivered) stats.sent += 1; else stats.dropped += 1;
    } else {
      await withPlatformAdmin(SYSTEM, (tx) => tx.pushOutbox.update({ where: { id: m.id }, data: { attempts: { increment: 1 } } }));
      stats.failed += 1;
    }
  }
  return stats;
}

/** Send a test message straight to the person's devices, so they can see it works. */
export async function sendTestPush(userId: string, sender: PushSender | null = null) {
  const keys = vapidFromEnv();
  const send = sender ?? (keys ? makeSender(keys) : null);
  if (!send) throw new Error("Push notifications are not set up on this server yet");
  const devices = await withUser(userId, (tx) => tx.pushSubscription.findMany({ where: { userId } }));
  if (devices.length === 0) throw new Error("Turn on notifications on this device first");
  let ok = 0;
  for (const d of devices) {
    const r = await send({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, { title: "Notifications are working", body: "You will see inspection updates, messages and other activity here.", url: "/me/notification-settings", tag: "push.test" }).catch(() => ({ status: 0 }));
    if (r.status >= 200 && r.status < 300) ok += 1;
    else if (r.status === 404 || r.status === 410) await withUser(userId, (tx) => tx.pushSubscription.deleteMany({ where: { id: d.id } }));
  }
  return { devices: devices.length, delivered: ok };
}
