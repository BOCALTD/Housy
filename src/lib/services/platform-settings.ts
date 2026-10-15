import { z } from "zod";
import { prisma, withPlatformAdmin } from "../db";
import { logActivity } from "../audit";

/** The platform-wide limits the administrator controls. Defaults apply until the administrator changes them. */
export const SETTING_DEFAULTS = {
  invite_expiry_days: "14",
  msg_per_minute: "20",
  new_conversations_per_day: "10",
  contact_policy: "MASK",
  report_mute_threshold: "3",
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;

export interface PlatformSettings { inviteExpiryDays: number; messagesPerMinute: number; newConversationsPerDay: number; contactPolicy: "MASK" | "BLOCK"; reportMuteThreshold: number }

export async function readSettings(): Promise<PlatformSettings> {
  const rows = await prisma.platformSetting.findMany();
  const v = (k: SettingKey) => rows.find((r) => r.key === k)?.value ?? SETTING_DEFAULTS[k];
  return {
    inviteExpiryDays: Number(v("invite_expiry_days")),
    messagesPerMinute: Number(v("msg_per_minute")),
    newConversationsPerDay: Number(v("new_conversations_per_day")),
    contactPolicy: v("contact_policy") === "BLOCK" ? "BLOCK" : "MASK",
    reportMuteThreshold: Number(v("report_mute_threshold")),
  };
}

const schema = z.object({
  inviteExpiryDays: z.coerce.number().int().min(1, "Invitations last at least 1 day").max(90),
  messagesPerMinute: z.coerce.number().int().min(1).max(200),
  newConversationsPerDay: z.coerce.number().int().min(1).max(500),
  contactPolicy: z.enum(["MASK", "BLOCK"]),
  reportMuteThreshold: z.coerce.number().int().min(1).max(50),
});

export async function saveSettings(adminId: string, raw: z.input<typeof schema>) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  const d = schema.parse(raw);
  const entries: [SettingKey, string][] = [
    ["invite_expiry_days", String(d.inviteExpiryDays)], ["msg_per_minute", String(d.messagesPerMinute)],
    ["new_conversations_per_day", String(d.newConversationsPerDay)], ["contact_policy", d.contactPolicy], ["report_mute_threshold", String(d.reportMuteThreshold)],
  ];
  await withPlatformAdmin(adminId, async (tx) => {
    for (const [key, value] of entries) await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "platform", action: "settings.updated", detail: Object.fromEntries(entries) });
  });
}
