import { z } from "zod";
import { withPlatformAdmin, withUser } from "../db";
import { logActivity } from "../audit";
import { randomRef } from "../tokens";
import { rateLimit } from "../ratelimit";
import { validateUpload } from "../storage";
import { CASE_CATEGORIES, CASE_STATUSES, SEVERITIES, deadlineFor, defaultSeverity, isClosed, type CaseCategory, type CaseStatus, type Severity } from "../booking-rules";
import { notify } from "./notifications";
import { system } from "./rewards";

export const TARGET_KINDS = ["LISTING", "COMPANY", "AGENT", "USER", "REVIEW", "REEL", "BOOKING", "VACANCY", "COLLABORATION", "OTHER"] as const;
const EVIDENCE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const schema = z.object({
  category: z.string().refine((c) => c in CASE_CATEGORIES, "Choose what the report is about"),
  targetKind: z.enum(TARGET_KINDS).default("OTHER"),
  targetRef: z.string().trim().max(200).default(""),
  description: z.string().trim().min(10, "Describe what happened in a few sentences").max(5000),
});
type Evidence = { type: string; bytes: Uint8Array; name: string };

/** Open a report. Anyone signed in can. Up to three files of evidence. Reviewers see it with a deadline set by its severity. */
export async function openCase(userId: string, input: z.input<typeof schema>, evidence: Evidence[], o: { severity?: Severity; now?: Date } = {}) {
  const d = schema.parse(input);
  const now = o.now ?? new Date();
  if (!o.severity && !(await rateLimit(`case:${userId}`, 10, 864e5))) throw new Error("You have sent many reports today. If it is urgent, contact support.");
  if (evidence.length > 3) throw new Error("Attach up to three files");
  for (const f of evidence) { if (!EVIDENCE_TYPES.includes(f.type)) throw new Error("Evidence must be a PDF, JPG, PNG or WEBP file"); validateUpload(f.type, f.bytes); }
  const severity = o.severity ?? defaultSeverity(d.category as CaseCategory);
  const ref = randomRef("TS");
  const id = await withUser(userId, async (tx) => {
    const c = await tx.trustCase.create({ data: { ref, reporterId: userId, category: d.category, severity, targetKind: d.targetKind, targetRef: d.targetRef, description: d.description, dueAt: deadlineFor(severity, now) } });
    for (const f of evidence) await tx.trustCaseEvidence.create({ data: { caseId: c.id, reporterId: userId, name: f.name.slice(0, 200) || "evidence", mimeType: f.type, bytes: Buffer.from(f.bytes) } });
    return c.id;
  });
  await system(async (tx) => {
    await tx.trustCaseEvent.create({ data: { caseId: id, reporterId: userId, actorId: userId, kind: "MESSAGE", body: "We have your report. A person on our Trust and Safety team will look at it.", toReporter: true } });
    await logActivity(tx, { companyId: null, actorId: userId, entityType: "trust_case", entityId: id, action: "case.opened", detail: { ref, category: d.category, severity } });
    if (severity === "CRITICAL" || severity === "HIGH") {
      const admins = await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true } });
      for (const a of admins) if (a.id !== userId) await notify(tx, a.id, { kind: "security.case", title: `${severity === "CRITICAL" ? "Critical" : "High"} report ${ref}: ${CASE_CATEGORIES[d.category as CaseCategory]}`, body: d.description.slice(0, 300), link: `/admin/cases/${ref}` });
    }
  });
  return ref;
}

export async function myCases(userId: string) {
  return withUser(userId, (tx) => tx.trustCase.findMany({ where: { reporterId: userId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ref: true, category: true, status: true, createdAt: true, targetRef: true } }));
}

export async function myCase(userId: string, ref: string) {
  return withUser(userId, async (tx) => {
    const c = await tx.trustCase.findFirst({ where: { ref, reporterId: userId }, select: { id: true, ref: true, category: true, status: true, createdAt: true, targetKind: true, targetRef: true, description: true, outcomeForReporter: true, closedAt: true } });
    if (!c) return null;
    const [events, evidence] = await Promise.all([
      tx.trustCaseEvent.findMany({ where: { caseId: c.id, toReporter: true }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, body: true, createdAt: true, actorId: true } }),
      tx.trustCaseEvidence.findMany({ where: { caseId: c.id }, select: { id: true, name: true } }),
    ]);
    return { ...c, events, evidence };
  });
}

export async function replyToCase(userId: string, ref: string, body: string) {
  const text = body.trim();
  if (text.length < 3) throw new Error("Write a short reply");
  const c = await withUser(userId, async (tx) => {
    const c = await tx.trustCase.findFirst({ where: { ref, reporterId: userId } });
    if (!c) throw new Error("Report not found");
    await tx.trustCaseEvent.create({ data: { caseId: c.id, reporterId: userId, actorId: userId, kind: "REPLY", body: text.slice(0, 5000), toReporter: true } });
    return c;
  });
  if (c.assignedToId) await system((tx) => notify(tx, c.assignedToId!, { kind: "security.case_reply", title: `Reply on report ${c.ref}`, body: text.slice(0, 300), link: `/admin/cases/${c.ref}` }));
}

// ---------- Reviewers ----------

export async function adminCases(adminId: string, f: { status?: string; severity?: string; mine?: boolean }) {
  return withPlatformAdmin(adminId, async (tx) => {
    const where = {
      ...(f.status === "open" || !f.status ? { status: { in: ["OPEN", "INVESTIGATING", "WAITING_INFO"] } } : f.status === "closed" ? { status: { in: ["ACTION_TAKEN", "CLOSED_NO_ACTION"] } } : {}),
      ...(f.severity && (SEVERITIES as readonly string[]).includes(f.severity) ? { severity: f.severity } : {}),
      ...(f.mine ? { assignedToId: adminId } : {}),
    };
    const rows = await tx.trustCase.findMany({ where, orderBy: [{ dueAt: "asc" }], take: 200 });
    const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return rows.sort((a, b) => order[a.severity] - order[b.severity] || a.dueAt.getTime() - b.dueAt.getTime());
  });
}

export async function adminCase(adminId: string, ref: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.trustCase.findFirst({ where: { ref } });
    if (!c) return null;
    const [events, evidence, reporter, admins] = await Promise.all([
      tx.trustCaseEvent.findMany({ where: { caseId: c.id }, orderBy: { createdAt: "asc" } }),
      tx.trustCaseEvidence.findMany({ where: { caseId: c.id }, select: { id: true, name: true, mimeType: true } }),
      tx.user.findUnique({ where: { id: c.reporterId }, select: { name: true, email: true } }),
      tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true, name: true } }),
    ]);
    return { ...c, events, evidence, reporter, admins };
  });
}

const updateSchema = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  assignToId: z.string().optional(),
  note: z.string().trim().max(5000).default(""),
  messageToReporter: z.string().trim().max(2000).default(""),
});

/** Change a case: assign it, set severity (the deadline follows), change status, add a private note, or write to the reporter. */
export async function updateCase(adminId: string, ref: string, input: z.input<typeof updateSchema>, now = new Date()) {
  const d = updateSchema.parse(input);
  const out = await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.trustCase.findFirst({ where: { ref } });
    if (!c) throw new Error("Case not found");
    if (c.reporterId === adminId) throw new Error("You cannot handle a case you reported yourself");
    const data: Record<string, unknown> = {};
    const lines: { kind: string; body: string; toReporter: boolean }[] = [];
    if (d.assignToId !== undefined && d.assignToId !== (c.assignedToId ?? "")) {
      if (d.assignToId) { const a = await tx.user.findFirst({ where: { id: d.assignToId, isPlatformAdmin: true } }); if (!a) throw new Error("Assign it to a platform administrator"); }
      data.assignedToId = d.assignToId || null; lines.push({ kind: "ASSIGN", body: d.assignToId ? "Assigned" : "Unassigned", toReporter: false });
    }
    if (d.severity && d.severity !== c.severity) { data.severity = d.severity; data.dueAt = deadlineFor(d.severity, c.createdAt); lines.push({ kind: "SEVERITY", body: `${c.severity} → ${d.severity}`, toReporter: false }); }
    if (d.status && d.status !== c.status) {
      if (isClosed(d.status as CaseStatus) && d.messageToReporter.length < 5) throw new Error("When closing, tell the reporter what happened (they see this message)");
      data.status = d.status; data.closedAt = isClosed(d.status as CaseStatus) ? now : null;
      if (isClosed(d.status as CaseStatus)) data.outcomeForReporter = d.messageToReporter;
      lines.push({ kind: "STATUS", body: `${c.status} → ${d.status}`, toReporter: false });
    }
    if (d.note) lines.push({ kind: "NOTE", body: d.note, toReporter: false });
    if (d.messageToReporter) lines.push({ kind: "MESSAGE", body: d.messageToReporter, toReporter: true });
    if (!lines.length) throw new Error("Nothing to change");
    if (Object.keys(data).length) await tx.trustCase.update({ where: { id: c.id }, data });
    for (const l of lines) await tx.trustCaseEvent.create({ data: { caseId: c.id, reporterId: c.reporterId, actorId: adminId, ...l } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "trust_case", entityId: c.id, action: "case.updated", detail: { ref, changes: lines.map((l) => l.kind) } });
    return c;
  });
  if (d.messageToReporter) await system((tx) => notify(tx, out.reporterId, { kind: "security.case_update", title: `Update on your report ${out.ref}`, body: d.messageToReporter.slice(0, 300), link: `/trust/reports/${out.ref}` }));
}

/** An enforcement action recorded on the case. Taking a listing offline is carried out here; other actions are recorded as done. */
export async function caseAction(adminId: string, ref: string, action: "TAKE_LISTING_OFFLINE" | "RECORD", detail: string) {
  const text = detail.trim();
  if (text.length < 5) throw new Error("Describe the action taken");
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.trustCase.findFirst({ where: { ref } });
    if (!c) throw new Error("Case not found");
    if (action === "TAKE_LISTING_OFFLINE") {
      const l = await tx.listing.findFirst({ where: { publicRef: c.targetRef.trim().toUpperCase() } });
      if (!l) throw new Error("The case does not point to a listing reference");
      await tx.listing.update({ where: { id: l.id }, data: { status: "UNAVAILABLE" } });
      await logActivity(tx, { companyId: l.companyId, actorId: adminId, entityType: "listing", entityId: l.id, action: "listing.taken_offline", detail: { case: ref, reason: text } });
    }
    await tx.trustCaseEvent.create({ data: { caseId: c.id, reporterId: c.reporterId, actorId: adminId, kind: "ACTION", body: `${action === "TAKE_LISTING_OFFLINE" ? "Listing taken offline. " : ""}${text}`, toReporter: false } });
  });
}

export async function caseEvidence(viewer: { userId: string; platformAdmin: boolean }, id: string) {
  const run = viewer.platformAdmin ? withPlatformAdmin : withUser;
  return run(viewer.userId, (tx) => tx.trustCaseEvidence.findFirst({ where: { id, ...(viewer.platformAdmin ? {} : { reporterId: viewer.userId }) }, select: { name: true, mimeType: true, bytes: true } }));
}
