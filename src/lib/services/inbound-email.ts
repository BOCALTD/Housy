import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma, withPlatformAdmin, withTenant } from "../db";
import { logActivity } from "../audit";
import { todayInLagos } from "../dates";
import { rateLimit } from "../ratelimit";
import { saveFile, validateUpload } from "../storage";
import { formatReference } from "../correspondence-rules";
import { parseInbound, tokenFrom } from "../inbound-email-rules";
import { notify } from "./notifications";
import { assertCan, type Ctx } from "./context";

// Incoming email. Each company has a private forwarding address (in+<token>@<inbound domain>). The email provider receives mail
// for that domain and posts each email to /api/inbound-email with Housy's secret. The email is registered in the correspondence
// register as an incoming letter, linked to the client whose email address sent it, with its attachments, and the company's
// managers are told. The same email (Message-ID) is never registered twice.
// Set up in Admin, Settings, Incoming email: the domain, and the address to give the provider.

const DOMAIN_KEY = "inbound_email_domain";
const SECRET_KEY = "inbound_email_secret";

export async function inboundConfig() {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: [DOMAIN_KEY, SECRET_KEY] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  return { domain: get(DOMAIN_KEY), secret: get(SECRET_KEY) };
}

async function assertAdmin(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

/** Save the inbound domain; a secret for the provider's address is made the first time (and on request). */
export async function saveInboundConfig(adminId: string, domainRaw: string, newSecret = false) {
  await assertAdmin(adminId);
  const domain = domainRaw.trim().toLowerCase().replace(/^@/, "");
  if (domain && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) throw new Error("Enter the domain only, such as in.yourdomain.com");
  const cur = await inboundConfig();
  const secret = newSecret || !cur.secret ? randomBytes(24).toString("base64url") : cur.secret;
  await withPlatformAdmin(adminId, async (tx) => {
    for (const [key, value] of [[DOMAIN_KEY, domain], [SECRET_KEY, secret]]) {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "inbound_email", action: "settings.inbound_email", detail: { domain, newSecret: newSecret || !cur.secret } });
  });
}

export function secretMatches(given: string, secret: string) {
  if (!secret || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The company's forwarding address (made the first time it is asked for), or null until the platform has set up a domain. */
export async function companyInboundAddress(ctx: Ctx, regenerate = false) {
  assertCan(ctx, "correspondence.register");
  const { domain } = await inboundConfig();
  if (!domain) return null;
  const token = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { inboundToken: true } });
    if (c.inboundToken && !regenerate) return c.inboundToken;
    const t = randomBytes(9).toString("hex");
    await tx.company.update({ where: { id: ctx.companyId }, data: { inboundToken: t } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: regenerate ? "inbound_email.address_changed" : "inbound_email.address_made", detail: {} });
    return t;
  });
  return `in+${token}@${domain}`;
}

export type InboundResult = { status: "registered" | "duplicate" | "ignored"; reason?: string; refs?: string[] };

/** Register one received email for each company it was sent to. */
export async function receiveInbound(payload: unknown, now = new Date()): Promise<InboundResult> {
  const { domain } = await inboundConfig();
  if (!domain) return { status: "ignored", reason: "incoming email is not set up" };
  const mail = parseInbound(payload);
  const tokens = [...new Set(mail.recipients.map((r) => tokenFrom(r, domain)).filter((t): t is string => !!t))];
  if (!tokens.length) return { status: "ignored", reason: "no company address among the recipients" };
  if (!mail.fromEmail) return { status: "ignored", reason: "no sender" };
  const refs: string[] = [];
  let duplicate = false;
  for (const token of tokens.slice(0, 5)) {
    const company = await withPlatformAdmin("system", (tx) => tx.company.findUnique({ where: { inboundToken: token }, select: { id: true, name: true, refPrefix: true, suspendedAt: true } }));
    if (!company || company.suspendedAt) continue;
    if (!(await rateLimit(`inbound:${company.id}`, 500, 3600_000))) continue;
    const owner = await withTenant(company.id, "system", (tx) => tx.membership.findFirst({ where: { companyId: company.id, role: "COMPANY_SUPER_ADMIN", status: "ACTIVE" }, select: { userId: true } }));
    if (!owner) continue;
    const r = await withTenant(company.id, owner.userId, async (tx) => {
      if (mail.messageId && await tx.correspondence.findFirst({ where: { companyId: company.id, messageId: mail.messageId }, select: { id: true } })) return null;
      const client = await tx.client.findFirst({ where: { companyId: company.id, emailNorm: mail.fromEmail, mergedIntoId: null }, select: { id: true, name: true } });
      const year = todayInLagos(now).getUTCFullYear();
      const rows = await tx.$queryRaw<{ last_number: number }[]>`
        INSERT INTO correspondence_counters (company_id, year, last_number) VALUES (${company.id}, ${year}, 1)
        ON CONFLICT (company_id, year) DO UPDATE SET last_number = correspondence_counters.last_number + 1
        RETURNING last_number`;
      const ref = formatReference(company.refPrefix, null, year, Number(rows[0].last_number));
      const skipped: string[] = [];
      const rec = await tx.correspondence.create({
        data: {
          companyId: company.id, ref, direction: "INCOMING", subject: mail.subject || "(no subject)", description: mail.text.slice(0, 5000),
          category: client ? "Client" : "General", priority: "NORMAL", status: "REGISTERED",
          senderName: (mail.fromName || client?.name || mail.fromEmail).slice(0, 200), recipientName: company.name.slice(0, 200),
          externalRef: "", dateReceived: todayInLagos(now), createdById: owner.userId, clientId: client?.id ?? null,
          fromEmail: mail.fromEmail.slice(0, 200), messageId: mail.messageId || null,
        },
      });
      for (const a of mail.attachments.slice(0, 10)) {
        try {
          validateUpload(a.type, a.bytes);
          const storageKey = await saveFile(tx, company.id, a.type, a.bytes);
          await tx.correspondenceAttachment.create({ data: { companyId: company.id, correspondenceId: rec.id, title: a.name, fileName: a.name, mimeType: a.type, sizeBytes: a.bytes.byteLength, storageKey, uploadedById: owner.userId }, select: { id: true } });
        } catch { skipped.push(a.name); }
      }
      const note = `Received by email from ${mail.fromEmail}${client ? `, linked to client ${client.name}` : ""}${mail.autoReply ? " (an automatic reply)" : ""}${skipped.length ? `. Not kept (type or size not accepted): ${skipped.join(", ").slice(0, 300)}` : ""}`;
      await tx.correspondenceAction.create({ data: { companyId: company.id, correspondenceId: rec.id, kind: "REGISTERED", fromStatus: null, toStatus: "REGISTERED", note, actorId: owner.userId }, select: { id: true } });
      await logActivity(tx, { companyId: company.id, actorId: null, entityType: "correspondence", entityId: rec.id, action: "correspondence.received_by_email", detail: { from: mail.fromEmail, client: client?.id ?? null, attachments: mail.attachments.length, skipped: skipped.length } });
      if (!mail.autoReply) {
        const managers = await tx.membership.findMany({ where: { companyId: company.id, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] } }, select: { userId: true }, take: 20 });
        for (const m of managers) await notify(tx, m.userId, { kind: "correspondence.email", title: `Email from ${mail.fromName || mail.fromEmail}`, body: mail.subject.slice(0, 120), link: `/app/correspondence/${rec.id}`, dedupeKey: `inbound:${rec.id}:${m.userId}` });
      }
      return ref;
    });
    if (r) refs.push(r); else duplicate = true;
  }
  if (refs.length) return { status: "registered", refs };
  return duplicate ? { status: "duplicate" } : { status: "ignored", reason: "no company matched" };
}
