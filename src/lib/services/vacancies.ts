import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, withPlatformAdmin, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { randomRef } from "../tokens";
import { MAX_UPLOAD_BYTES, validateUpload } from "../storage";
import {
  addressKey, areaCount, bytesHash, findDuplicates, nextStage, ownerFacingReporter, stageMoveProblem, textHash, vacancySignals, vacancyStatusText,
  type Candidate, type VacancyStageName,
} from "../vacancy-rules";
import { SIGNAL_TEXT } from "../reward-rules";
import { notify } from "./notifications";
import { openReward, readRewardSettings, reverseSource, system } from "./rewards";

// Vacancy reports. A report is a sighting. Verifying one pays the reporter; it never publishes anything. Permission to advertise a
// property belongs to its owner or authorised agent and is recorded separately, on a lead.

export const PROPERTY_TYPES = ["HOUSE", "FLAT", "ROOM", "SHOP", "OFFICE", "LAND", "WAREHOUSE", "OTHER"] as const;
export const PURPOSES = ["RENT", "SALE", "UNKNOWN"] as const;
export const MAX_PHOTOS = 3;
export const VACANCY_PAGE = 8;
const HARD_DAILY_LIMIT = 30;

const flag = z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true");
const optNum = (min: number, max: number) => z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) { ctx.addIssue({ code: "custom", message: `Enter a number between ${min} and ${max}` }); return z.NEVER; }
  return n;
});
const reportSchema = z.object({
  propertyType: z.enum(PROPERTY_TYPES, { error: "Choose the kind of property" }),
  purpose: z.enum(PURPOSES).default("UNKNOWN"),
  bedrooms: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const n = Number.parseInt(v, 10);
    if (!Number.isInteger(n) || n < 0 || n > 100) { ctx.addIssue({ code: "custom", message: "Bedrooms must be a whole number from 0 to 100" }); return z.NEVER; }
    return n;
  }),
  address: z.string().trim().min(5, "Enter the street address or the nearest landmark").max(200),
  area: z.string().trim().min(2, "Enter the neighbourhood").max(100),
  city: z.string().trim().min(2, "Enter the city or town").max(100),
  state: z.string().trim().min(2, "Enter the state").max(100),
  latitude: optNum(-90, 90),
  longitude: optNum(-180, 180),
  description: z.string().trim().min(20, "Describe what you saw in at least a sentence or two").max(1500),
  observedOn: z.string().min(1, "When did you see it?"),
  ownerContact: z.string().trim().max(200).default(""),
  allowContact: flag,
  showNameToOwner: flag,
  understood: flag,
});
export type ReportInput = z.input<typeof reportSchema>;
export interface UploadedPhoto { name: string; mimeType: string; bytes: Uint8Array }

const user = async (tx: Tx, id: string) => tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, email: true } });
const dayStart = (d = new Date()) => new Date(d.getTime() - 24 * 3600_000);
const eventRow = (reportId: string, actorName: string, note: string, o: { stage?: VacancyStageName; outcome?: "OPEN" | "APPROVED" | "REJECTED" | "NEEDS_INFO" | "MERGED" | "WITHDRAWN"; toReporter?: boolean } = {}) =>
  ({ reportId, actorName, note: note.slice(0, 1000), stage: o.stage ?? null, outcome: o.outcome ?? null, toReporter: o.toReporter ?? true });

async function adminOnly(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true, name: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  return u;
}

// ---------- The reporter ----------

export async function submitVacancy(userId: string, raw: ReportInput, photos: UploadedPhoto[]) {
  const d = reportSchema.parse(raw);
  if (!d.understood) throw new Error("Please confirm you have read how your report and your privacy are handled");
  const observed = new Date(`${d.observedOn}T00:00:00Z`);
  if (Number.isNaN(observed.getTime())) throw new Error("Check the date you saw the property");
  if (observed.getTime() > Date.now() + 864e5) throw new Error("The date you saw it cannot be in the future");
  if (observed.getTime() < Date.now() - 60 * 864e5) throw new Error("A sighting more than 60 days old is probably out of date. Report only what you saw recently.");
  if (d.latitude !== null && d.longitude === null || d.latitude === null && d.longitude !== null) throw new Error("Give both the latitude and the longitude, or neither");
  if (photos.length > MAX_PHOTOS) throw new Error(`Add up to ${MAX_PHOTOS} photographs`);
  let total = 0;
  for (const p of photos) {
    if (!p.mimeType.startsWith("image/")) throw new Error("Photographs must be JPG, PNG or WEBP images");
    validateUpload(p.mimeType, p.bytes);
    total += p.bytes.byteLength;
  }
  if (total > MAX_UPLOAD_BYTES) throw new Error("The photographs together must be 4 MB or smaller");
  const settings = await readRewardSettings();
  const key = addressKey(d.address, d.area, d.city);
  const hash = textHash(d.description);
  const hashes = photos.map((p) => bytesHash(p.bytes));

  return system(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `vacancy:${key}`);
    const me = await user(tx, userId);
    const now = new Date();
    const today = await tx.vacancyReport.count({ where: { reporterId: userId, createdAt: { gte: dayStart(now) } } });
    if (today >= HARD_DAILY_LIMIT) throw new Error("You have sent a lot of reports today. Please try again tomorrow.");
    const live = { outcome: { in: ["OPEN", "APPROVED", "NEEDS_INFO"] as ("OPEN" | "APPROVED" | "NEEDS_INFO")[] } };
    const around = await tx.vacancyReport.findMany({
      where: { ...live, createdAt: { gte: new Date(now.getTime() - settings.duplicateWindowDays * 864e5) }, OR: [{ addressKey: key }, { state: d.state, city: d.city }] },
      select: { id: true, ref: true, reporterId: true, addressKey: true, lat: true, lng: true, propertyType: true, bedrooms: true, createdAt: true, clusterId: true },
      take: 500,
    });
    const me_: Candidate = { id: "new", reporterId: userId, addressKey: key, lat: d.latitude, lng: d.longitude, propertyType: d.propertyType, bedrooms: d.bedrooms, createdAt: now };
    const dup = findDuplicates(me_, around, settings.duplicateRadiusM, settings.duplicateWindowDays, now);
    if (dup.sameReporter) {
      const ref = around.find((a) => a.id === dup.sameReporter!.id)?.ref;
      throw new Error(`You already reported this place (${ref}). Open that report to add details or reply to a question.`);
    }
    const earliest = dup.earliest ? around.find((a) => a.id === dup.earliest!.id)! : null;
    const rejectedRecently = await tx.vacancyReport.count({ where: { reporterId: userId, outcome: "REJECTED", createdAt: { gte: new Date(now.getTime() - 90 * 864e5) } } });
    const photoReused = hashes.length ? (await tx.vacancyFile.count({ where: { sha256: { in: hashes }, report: { reporterId: { not: userId } } } })) > 0 : false;
    const textRepeated = (await tx.vacancyReport.count({ where: { descriptionHash: hash, reporterId: { not: userId } } })) > 0;
    const signals = vacancySignals({ photoReused, textRepeated, rejectedRecently, rejectFlag: settings.vacancyRejectFlag, reportsToday: today, perDay: settings.vacancyReportsPerDay, lat: d.latitude, lng: d.longitude });
    const id = randomUUID();
    const report = await tx.vacancyReport.create({
      data: {
        id, ref: randomRef("VR", 8), reporterId: userId, reporterName: me.name, propertyType: d.propertyType, purpose: d.purpose, bedrooms: d.bedrooms, address: d.address, area: d.area, city: d.city, state: d.state,
        lat: d.latitude, lng: d.longitude, addressKey: key, description: d.description, descriptionHash: hash, observedOn: observed, ownerContact: d.ownerContact,
        allowContact: d.allowContact, showNameToOwner: d.showNameToOwner, signals: signals.join(","), flagged: signals.length > 0,
        clusterId: earliest ? earliest.clusterId : id, duplicateOfId: earliest?.id ?? null,
      },
    });
    for (let i = 0; i < photos.length; i++) {
      await tx.vacancyFile.create({ data: { reportId: id, name: photos[i].name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || `photo-${i + 1}`, mimeType: photos[i].mimeType, sizeBytes: photos[i].bytes.byteLength, sha256: hashes[i], bytes: Buffer.from(photos[i].bytes) } });
    }
    await tx.vacancyEvent.create({ data: eventRow(id, "Platform", "Report received.", { stage: "SUBMITTED", outcome: "OPEN" }) });
    if (earliest) await tx.vacancyEvent.create({ data: eventRow(id, "Platform", `Possible duplicate of ${earliest.ref}. A reviewer will decide.`, { toReporter: false }) });
    if (signals.length) await tx.vacancyEvent.create({ data: eventRow(id, "Platform", `Warning signs for a reviewer to look at: ${signals.join(", ")}`, { toReporter: false }) });
    await notify(tx, userId, { kind: "vacancy.updated", title: "We received your vacancy report", body: report.ref, link: `/vacancies/${id}` });
    return report;
  });
}

const pageOf = (page: number) => Math.max(1, page);

export async function myVacancies(userId: string, page = 1) {
  return withUser(userId, async (tx) => {
    const rows = await tx.vacancyReport.findMany({ where: { reporterId: userId }, orderBy: { createdAt: "desc" }, skip: (pageOf(page) - 1) * VACANCY_PAGE, take: VACANCY_PAGE + 1 });
    const groups = await tx.vacancyReport.groupBy({ by: ["outcome"], where: { reporterId: userId }, _count: { _all: true } });
    return {
      items: rows.slice(0, VACANCY_PAGE).map((r) => ({ id: r.id, ref: r.ref, area: r.area, city: r.city, propertyType: r.propertyType, stage: r.stage, outcome: r.outcome, createdAt: r.createdAt, status: vacancyStatusText(r.stage, r.outcome, { reason: r.rejectReason, question: r.question }) })),
      more: rows.length > VACANCY_PAGE,
      counts: Object.fromEntries(groups.map((g) => [g.outcome, g._count._all])) as Record<string, number>,
    };
  });
}

export async function getMyVacancy(userId: string, id: string) {
  return withUser(userId, async (tx) => {
    const r = await tx.vacancyReport.findFirst({ where: { id, reporterId: userId }, include: { files: { select: { id: true, name: true, mimeType: true, sizeBytes: true } }, events: { where: { toReporter: true }, orderBy: { createdAt: "asc" } } } });
    if (!r) return null;
    const rewards = await tx.reward.findMany({ where: { userId, sourceType: { in: ["vacancy_report", "vacancy_lead", "vacancy_transaction"] }, sourceId: { in: [r.id] } } });
    const dispute = await tx.rewardDispute.findFirst({ where: { userId, subjectType: "VACANCY_REPORT", subjectId: r.id } });
    return { ...r, status: vacancyStatusText(r.stage, r.outcome, { reason: r.rejectReason, question: r.question }), rewards, dispute, ownerSees: ownerFacingReporter(r) };
  });
}

async function ownReport(tx: Tx, userId: string, id: string) {
  const r = await tx.vacancyReport.findFirst({ where: { id, reporterId: userId } });
  if (!r) throw new Error("Report not found");
  return r;
}

export async function replyToQuestion(userId: string, id: string, replyRaw: string) {
  const reply = z.string().trim().min(3, "Write your answer").max(1000).parse(replyRaw);
  return system(async (tx) => {
    const r = await ownReport(tx, userId, id);
    if (r.outcome !== "NEEDS_INFO") throw new Error("This report is not waiting for an answer");
    const done = await tx.vacancyReport.updateMany({ where: { id, outcome: "NEEDS_INFO" }, data: { outcome: "OPEN", reply, closedAt: null } });
    if (done.count !== 1) throw new Error("This report was just changed. Reload and try again.");
    await tx.vacancyEvent.create({ data: eventRow(id, r.reporterName, `Reporter's answer: ${reply}`, { outcome: "OPEN" }) });
  });
}

export async function withdrawVacancy(userId: string, id: string) {
  return system(async (tx) => {
    const r = await ownReport(tx, userId, id);
    if (!["OPEN", "NEEDS_INFO"].includes(r.outcome)) throw new Error("Only a report still being reviewed can be withdrawn");
    await tx.vacancyReport.update({ where: { id }, data: { outcome: "WITHDRAWN", closedAt: new Date() } });
    await tx.vacancyEvent.create({ data: eventRow(id, r.reporterName, "Withdrawn by the reporter.", { outcome: "WITHDRAWN" }) });
  });
}

/** Contact and naming choices belong to the reporter and can change at any time. */
export async function setReporterPrivacy(userId: string, id: string, p: { allowContact: boolean; showNameToOwner: boolean }) {
  return system(async (tx) => {
    const r = await ownReport(tx, userId, id);
    await tx.vacancyReport.update({ where: { id }, data: { allowContact: p.allowContact, showNameToOwner: p.showNameToOwner } });
    await tx.vacancyEvent.create({ data: eventRow(id, r.reporterName, `Privacy choices changed: contact outside the app ${p.allowContact ? "allowed" : "not allowed"}; name ${p.showNameToOwner ? "may be shown to the owner" : "kept from the owner"}.`, { toReporter: false }) });
  });
}

/** A rejected or merged report can be appealed once. A person who was not the reviewer decides. */
export async function appealVacancy(userId: string, id: string, reasonRaw: string) {
  const reason = z.string().trim().min(10, "Tell us in a sentence or two why you disagree").max(1000).parse(reasonRaw);
  return system(async (tx) => {
    const r = await ownReport(tx, userId, id);
    if (!["REJECTED", "MERGED"].includes(r.outcome)) throw new Error("Only a report that was not accepted can be appealed");
    if (r.appealedAt) throw new Error("This report has already been appealed. Each decision can be appealed once.");
    await tx.vacancyReport.update({ where: { id }, data: { appealedAt: new Date() } });
    const dispute = await tx.rewardDispute.create({ data: { subjectType: "VACANCY_REPORT", subjectId: id, userId, reason } });
    await tx.vacancyEvent.create({ data: eventRow(id, r.reporterName, `Appeal: ${reason}`) });
    return dispute;
  });
}

/** A photograph is served only to the person who took it and to the review team. */
export async function vacancyPhoto(viewerId: string, fileId: string) {
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { isPlatformAdmin: true } });
  if (!viewer) return null;
  const run = viewer.isPlatformAdmin ? withPlatformAdmin(viewerId, (tx) => tx.vacancyFile.findUnique({ where: { id: fileId } })) : withUser(viewerId, (tx) => tx.vacancyFile.findUnique({ where: { id: fileId } }));
  const f = await run;
  return f ? { name: f.name, mimeType: f.mimeType, bytes: Buffer.from(f.bytes) } : null;
}

// ---------- The review team ----------

export async function vacancyQueue(adminId: string, f: { outcome?: string; stage?: string; flagged?: boolean; q?: string } = {}, page = 1) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const where = {
      ...(f.outcome ? { outcome: f.outcome as "OPEN" } : {}), ...(f.stage ? { stage: f.stage as "SUBMITTED" } : {}), ...(f.flagged ? { flagged: true } : {}),
      ...(f.q ? { OR: [{ ref: { contains: f.q.trim().toUpperCase() } }, { area: { contains: f.q.trim(), mode: "insensitive" as const } }, { city: { contains: f.q.trim(), mode: "insensitive" as const } }] } : {}),
    };
    const [rows, byOutcome, byStage, flagged] = await Promise.all([
      tx.vacancyReport.findMany({ where, orderBy: { createdAt: "asc" }, skip: (pageOf(page) - 1) * VACANCY_PAGE, take: VACANCY_PAGE + 1 }),
      tx.vacancyReport.groupBy({ by: ["outcome"], _count: { _all: true } }),
      tx.vacancyReport.groupBy({ by: ["stage"], where: { outcome: "OPEN" }, _count: { _all: true } }),
      tx.vacancyReport.count({ where: { flagged: true, outcome: { in: ["OPEN", "NEEDS_INFO"] } } }),
    ]);
    return {
      items: rows.slice(0, VACANCY_PAGE), more: rows.length > VACANCY_PAGE, flagged,
      byOutcome: Object.fromEntries(byOutcome.map((g) => [g.outcome, g._count._all])) as Record<string, number>,
      byStage: Object.fromEntries(byStage.map((g) => [g.stage, g._count._all])) as Record<string, number>,
    };
  });
}

export async function getVacancyAdmin(adminId: string, id: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.vacancyReport.findUnique({ where: { id }, include: { files: { select: { id: true, name: true, mimeType: true, sizeBytes: true, sha256: true } }, events: { orderBy: { createdAt: "asc" } }, lead: true } });
    if (!r) return null;
    const [cluster, reporter, rewards, dispute] = await Promise.all([
      tx.vacancyReport.findMany({ where: { clusterId: r.clusterId, id: { not: r.id } }, select: { id: true, ref: true, outcome: true, stage: true, createdAt: true, reporterName: true, address: true } }),
      tx.user.findUniqueOrThrow({ where: { id: r.reporterId }, select: { name: true, email: true } }),
      tx.reward.findMany({ where: { sourceId: { in: [r.id, ...(r.lead ? [r.lead.id] : [])] }, sourceType: { startsWith: "vacancy" } } }),
      tx.rewardDispute.findFirst({ where: { subjectType: "VACANCY_REPORT", subjectId: r.id } }),
    ]);
    const reused = r.files.length ? await tx.vacancyFile.findMany({ where: { sha256: { in: r.files.map((x) => x.sha256) }, reportId: { not: r.id } }, select: { report: { select: { ref: true } } } }) : [];
    return {
      ...r,
      cluster, rewards, dispute, reusedIn: [...new Set(reused.map((x) => x.report.ref))],
      signalText: (r.signals ? r.signals.split(",") : []).map((s) => SIGNAL_TEXT[s] ?? s),
      // The reporter's address is shown only if they allowed contact outside the app. Their name is always known to the team, because they pay the reward.
      reporter: { name: reporter.name, email: r.allowContact ? reporter.email : null },
      ownerSees: ownerFacingReporter(r),
      listingNote: "Nothing in a vacancy report publishes a listing. Permission is recorded on the lead below.",
    };
  });
}

type Outcome = "OPEN" | "APPROVED" | "REJECTED" | "NEEDS_INFO" | "MERGED" | "WITHDRAWN";
async function load(tx: Tx, id: string) {
  const r = await tx.vacancyReport.findUnique({ where: { id }, include: { lead: true } });
  if (!r) throw new Error("Report not found");
  return r;
}
const tell = (tx: Tx, userId: string, title: string, id: string, body = "") => notify(tx, userId, { kind: "vacancy.updated", title, body: body.slice(0, 200), link: `/vacancies/${id}` });

export async function advanceStage(adminId: string, id: string, noteRaw = "") {
  const who = await adminOnly(adminId);
  const note = z.string().trim().max(500).parse(noteRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    const to = nextStage(r.stage);
    if (!to) throw new Error("This report is already at the last stage");
    const problem = stageMoveProblem(r.stage, to, r.outcome as Outcome);
    if (problem) throw new Error(problem);
    if (r.stage === "DUPLICATE_CHECK" && r.duplicateOfId) throw new Error("Decide whether this is a duplicate before moving on.");
    if (r.stage === "INITIAL_REVIEW" && r.flagged) throw new Error("Look at the warning signs before moving on, and clear them or reject the report.");
    if (r.stage === "OWNER_VERIFICATION" && !r.lead) throw new Error("Record who you contacted, on the lead, before moving on.");
    if (r.stage === "OWNER_VERIFICATION" && r.lead && ["DECLINED", "WITHDRAWN"].includes(r.lead.status)) throw new Error("The owner declined. Reject the report or reopen the lead.");
    const done = await tx.vacancyReport.updateMany({ where: { id, stage: r.stage, outcome: "OPEN" }, data: { stage: to } });
    if (done.count !== 1) throw new Error("This report was just changed. Reload and try again.");
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, note, { stage: to, outcome: "OPEN" }) });
    await tell(tx, r.reporterId, `Your report moved on: ${to.replace(/_/g, " ").toLowerCase()}`, id, r.ref);
  });
}

export async function requestInfo(adminId: string, id: string, questionRaw: string) {
  const who = await adminOnly(adminId);
  const question = z.string().trim().min(5, "Ask a clear question").max(500).parse(questionRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (r.outcome !== "OPEN") throw new Error("Only an open report can be sent back with a question");
    await tx.vacancyReport.update({ where: { id }, data: { outcome: "NEEDS_INFO", question } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Question: ${question}`, { outcome: "NEEDS_INFO" }) });
    await tell(tx, r.reporterId, "We need a little more information", id, question);
  });
}

export async function rejectVacancy(adminId: string, id: string, reasonRaw: string) {
  const who = await adminOnly(adminId);
  const reason = z.string().trim().min(5, "Give a reason the reporter can read").max(500).parse(reasonRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (!["OPEN", "NEEDS_INFO"].includes(r.outcome)) throw new Error("Only a report still being reviewed can be rejected");
    await tx.vacancyReport.update({ where: { id }, data: { outcome: "REJECTED", rejectReason: reason, closedAt: new Date() } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, reason, { outcome: "REJECTED" }) });
    await tell(tx, r.reporterId, "Your vacancy report was not accepted", id, reason);
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "vacancy_report", entityId: id, action: "vacancy.rejected", detail: { reason } });
  });
}

/** A person looks at the warning signs. They clear them (the report carries on) or confirm a problem (the report is rejected). */
export async function reviewSignals(adminId: string, id: string, decision: "clear" | "confirm", noteRaw: string) {
  const who = await adminOnly(adminId);
  const note = z.string().trim().min(5, "Write what you found").max(500).parse(noteRaw);
  if (decision === "confirm") return rejectVacancy(adminId, id, `After a check: ${note}`);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (!r.flagged) throw new Error("This report has no warning signs waiting");
    await tx.vacancyReport.update({ where: { id }, data: { flagged: false, reviewNote: note } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Warning signs checked and cleared: ${note}`, { toReporter: false }) });
  });
}

export async function approveVacancy(adminId: string, id: string, noteRaw = "") {
  const who = await adminOnly(adminId);
  const note = z.string().trim().max(500).parse(noteRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `vacancy-cluster:${(await load(tx, id)).clusterId}`);
    const r = await load(tx, id);
    if (r.outcome !== "OPEN") throw new Error("Only an open report can be approved");
    if (r.stage !== "REWARD_REVIEW") throw new Error("A report is approved at the last stage, after every check before it.");
    if (r.flagged) throw new Error("Look at the warning signs first.");
    if (r.duplicateOfId) throw new Error("Decide whether this is a duplicate first.");
    const other = await tx.vacancyReport.findFirst({ where: { clusterId: r.clusterId, id: { not: id }, outcome: "APPROVED" }, select: { ref: true } });
    if (other) throw new Error(`The same property was already verified from report ${other.ref}. Only one report earns the verification reward. Merge this one, or use an ownership override with a reason.`);
    await tx.vacancyReport.update({ where: { id }, data: { outcome: "APPROVED", closedAt: new Date(), reviewNote: note } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, note || "Verified.", { outcome: "APPROVED" }) });
    const reward = await openReward(tx, { userId: r.reporterId, programme: "VACANCY", event: "VACANCY_VERIFIED", sourceType: "vacancy_report", sourceId: id, sourceLabel: `Vacancy report ${r.ref}, ${r.area}` });
    await tell(tx, r.reporterId, "Your vacancy report was verified", id, "A verified report is not a published listing.");
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "vacancy_report", entityId: id, action: "vacancy.approved", detail: { reward: reward.ref } });
    return reward;
  });
}

/** Decide a possible duplicate. The earliest report is the default owner; an override needs a reason and is logged. */
export async function resolveDuplicate(adminId: string, id: string, decision: "not_duplicate" | "merge" | "prefer_this", noteRaw: string) {
  const who = await adminOnly(adminId);
  const note = z.string().trim().min(5, "Write the reason").max(500).parse(noteRaw);
  const out = await withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (!r.duplicateOfId) throw new Error("This report has no duplicate to decide");
    if (!["OPEN", "NEEDS_INFO"].includes(r.outcome)) throw new Error("Only a report still being reviewed can be decided");
    const original = await tx.vacancyReport.findUniqueOrThrow({ where: { id: r.duplicateOfId } });
    if (decision === "not_duplicate") {
      await tx.vacancyReport.update({ where: { id }, data: { duplicateOfId: null, clusterId: r.id } });
      await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Not a duplicate: ${note}`, { toReporter: false }) });
    } else if (decision === "merge") {
      await tx.vacancyReport.update({ where: { id }, data: { outcome: "MERGED", mergedIntoId: original.id, closedAt: new Date() } });
      await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Merged into ${original.ref}. ${note}`, { outcome: "MERGED" }) });
      await tell(tx, r.reporterId, "Your report was merged with an earlier one", id, original.ref);
    } else {
      if (["OPEN", "NEEDS_INFO"].indexOf(original.outcome) < 0 && original.outcome !== "APPROVED") throw new Error("The earlier report is already closed");
      const paid = await tx.reward.findFirst({ where: { sourceType: "vacancy_report", sourceId: original.id, status: { in: ["PAYABLE", "PAID"] } } });
      if (paid) throw new Error("The earlier report's reward is already payable or paid. It cannot be transferred.");
      await tx.vacancyReport.update({ where: { id: original.id }, data: { outcome: "MERGED", mergedIntoId: id, closedAt: new Date() } });
      await tx.vacancyReport.update({ where: { id }, data: { duplicateOfId: null } });
      await tx.vacancyEvent.create({ data: eventRow(original.id, who.name, `Merged into ${r.ref} by an administrator. ${note}`, { outcome: "MERGED" }) });
      await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Ownership override over ${original.ref}: ${note}`, { toReporter: false }) });
      await tell(tx, original.reporterId, "Your report was merged with another", original.id, r.ref);
      await logActivity(tx, { companyId: null, actorId: adminId, entityType: "vacancy_report", entityId: id, action: "vacancy.ownership_override", detail: { over: original.ref, note } });
    }
    return { decision, giveUp: decision === "merge" ? id : decision === "prefer_this" ? original.id : null };
  });
  // A report merged away gives up any reward it had already earned.
  if (out.giveUp) await reverseSource("vacancy_report", out.giveUp, "The report was merged into another.");
  return out.decision;
}

// ---------- Leads: permission to publish is not the same as having seen the property ----------

export async function saveLead(adminId: string, id: string, contactNameRaw: string) {
  const who = await adminOnly(adminId);
  const contactName = z.string().trim().min(2, "Who did you contact?").max(200).parse(contactNameRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (["REJECTED", "WITHDRAWN", "MERGED"].includes(r.outcome)) throw new Error("This report is closed");
    const lead = r.lead
      ? await tx.vacancyLead.update({ where: { id: r.lead.id }, data: { contactName, status: r.lead.status === "DECLINED" || r.lead.status === "WITHDRAWN" ? "CONTACTING" : r.lead.status } })
      : await tx.vacancyLead.create({ data: { reportId: id, contactName, createdById: adminId } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Contact recorded: ${contactName}`, { toReporter: false }) });
    return lead;
  });
}

export async function authoriseLead(adminId: string, id: string, noteRaw: string) {
  const who = await adminOnly(adminId);
  const note = z.string().trim().min(5, "Record how the owner or agent gave permission").max(500).parse(noteRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (!r.lead) throw new Error("Record who you contacted first");
    if (r.lead.status === "AUTHORISED") throw new Error("Permission is already recorded");
    await tx.vacancyLead.update({ where: { id: r.lead.id }, data: { status: "AUTHORISED", authorisationNote: note, authorisedAt: new Date() } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Owner or agent gave permission: ${note}`, { toReporter: false }) });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "vacancy_lead", entityId: r.lead.id, action: "vacancy_lead.authorised", detail: { note } });
  });
}

export async function declineLead(adminId: string, id: string, reasonRaw: string) {
  const who = await adminOnly(adminId);
  const reason = z.string().trim().min(5, "Say what the owner told you").max(500).parse(reasonRaw);
  const out = await withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (!r.lead) throw new Error("There is no lead");
    await tx.vacancyLead.update({ where: { id: r.lead.id }, data: { status: "DECLINED", authorisationNote: reason } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Owner or agent declined: ${reason}`, { toReporter: false }) });
    return r.lead.id;
  });
  await reverseSource("vacancy_lead", out, "The owner or agent withdrew permission.");
}

/** Attach the listing that was published with permission. Only a listing that is live earns the reporter the second reward. */
export async function linkListing(adminId: string, id: string, listingRef: string) {
  const who = await adminOnly(adminId);
  const ref = z.string().trim().min(3, "Enter the listing reference").parse(listingRef);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (!r.lead || r.lead.status !== "AUTHORISED") throw new Error("A listing can be linked only after the owner or agent has given permission");
    const listing = await tx.listing.findFirst({ where: { OR: [{ id: ref }, { publicRef: ref }] }, select: { id: true, status: true, title: true } });
    if (!listing) throw new Error("No listing has that reference");
    await tx.vacancyLead.update({ where: { id: r.lead.id }, data: { listingId: listing.id } });
    await tx.vacancyEvent.create({ data: eventRow(id, who.name, `Linked to listing ${ref}`, { toReporter: false }) });
    return listing.status === "PUBLISHED" ? emitListed(tx, id) : null;
  });
}

async function emitListed(tx: Tx, reportId: string) {
  const r = await tx.vacancyReport.findUnique({ where: { id: reportId }, include: { lead: true } });
  if (!r || r.outcome !== "APPROVED" || !r.lead || r.lead.status !== "AUTHORISED" || !r.lead.listingId) return null;
  const listing = await tx.listing.findUnique({ where: { id: r.lead.listingId }, select: { status: true } });
  if (listing?.status !== "PUBLISHED") return null;
  const reward = await openReward(tx, { userId: r.reporterId, programme: "VACANCY", event: "VACANCY_LISTED", sourceType: "vacancy_lead", sourceId: r.lead.id, sourceLabel: `Listing from vacancy report ${r.ref}` });
  await tell(tx, r.reporterId, "The property you reported is now listed", r.id, "Thank you.");
  return reward;
}
/** When the platform publishes a listing, any vacancy lead pointing at it pays out. */
export async function vacancyListingPublished(listingId: string): Promise<void> {
  try {
    await system(async (tx) => {
      const leads = await tx.vacancyLead.findMany({ where: { listingId }, select: { reportId: true } });
      for (const l of leads) await emitListed(tx, l.reportId);
    });
  } catch { /* A reward must never break publishing a listing. */ }
}

/** A person at the platform confirms a transaction on the property was completed. Not inferred from anything else. */
export async function attestTransaction(adminId: string, id: string, noteRaw: string) {
  await adminOnly(adminId);
  const note = z.string().trim().min(5, "Say how you know").max(500).parse(noteRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await load(tx, id);
    if (r.outcome !== "APPROVED") throw new Error("Only an approved report can be linked to a transaction");
    const reward = await openReward(tx, { userId: r.reporterId, programme: "VACANCY", event: "VACANCY_TRANSACTION", sourceType: "vacancy_transaction", sourceId: id, sourceLabel: `Transaction on vacancy report ${r.ref}` });
    await tx.vacancyEvent.create({ data: eventRow(id, "Administrator", `Transaction confirmed: ${note}`, { toReporter: false }) });
    return reward;
  });
}

/** The administrator rules on an appeal. Upholding reopens the report for a fresh review; denying stands. */
export async function resolveVacancyAppeal(adminId: string, disputeId: string, decision: "uphold" | "deny", resolutionRaw: string) {
  const who = await adminOnly(adminId);
  const resolution = z.string().trim().min(5, "Explain the decision").max(1000).parse(resolutionRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const d = await tx.rewardDispute.findUnique({ where: { id: disputeId } });
    if (!d || d.subjectType !== "VACANCY_REPORT") throw new Error("Appeal not found");
    if (d.status !== "OPEN") throw new Error("This appeal is already decided");
    const r = await load(tx, d.subjectId);
    await tx.rewardDispute.update({ where: { id: d.id }, data: { status: decision === "uphold" ? "UPHELD" : "DENIED", resolution, resolvedById: adminId, resolvedAt: new Date() } });
    if (decision === "uphold") {
      await tx.vacancyReport.update({ where: { id: r.id }, data: { outcome: "OPEN", stage: "INITIAL_REVIEW", closedAt: null, rejectReason: "", mergedIntoId: null, flagged: false } });
      await tx.vacancyEvent.create({ data: eventRow(r.id, who.name, `Appeal upheld: ${resolution}. The report is back under review.`, { stage: "INITIAL_REVIEW", outcome: "OPEN" }) });
      await tell(tx, r.reporterId, "Your appeal was upheld", r.id, resolution);
    } else {
      await tx.vacancyEvent.create({ data: eventRow(r.id, who.name, `Appeal denied: ${resolution}`) });
      await tell(tx, r.reporterId, "Your appeal was decided", r.id, resolution);
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "vacancy_report", entityId: r.id, action: `vacancy_appeal.${decision}`, detail: {} });
  });
}

export async function openVacancyAppeals(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.rewardDispute.findMany({ where: { subjectType: "VACANCY_REPORT", status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 50 });
    const reports = await tx.vacancyReport.findMany({ where: { id: { in: rows.map((r) => r.subjectId) } }, select: { id: true, ref: true, outcome: true, rejectReason: true } });
    const by = new Map(reports.map((r) => [r.id, r]));
    return rows.map((d) => ({ ...d, report: by.get(d.subjectId) ?? null }));
  });
}

// ---------- Aggregate intelligence for administrators ----------

/** Where vacancies are being seen. Areas with fewer than three reports are not broken out, so no figure points at one reporter. */
export async function vacancyAnalytics(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const [byArea, byOutcome, byType, decided, flagged, total, rewards] = await Promise.all([
      tx.vacancyReport.groupBy({ by: ["state", "city", "area"], _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 200 }),
      tx.vacancyReport.groupBy({ by: ["outcome"], _count: { _all: true } }),
      tx.vacancyReport.groupBy({ by: ["propertyType"], _count: { _all: true } }),
      tx.vacancyReport.findMany({ where: { closedAt: { not: null }, outcome: { in: ["APPROVED", "REJECTED"] } }, select: { createdAt: true, closedAt: true }, take: 2000 }),
      tx.vacancyReport.count({ where: { flagged: true } }),
      tx.vacancyReport.count(),
      tx.reward.groupBy({ by: ["status"], where: { programme: "VACANCY" }, _count: { _all: true }, _sum: { amountKobo: true } }),
    ]);
    const small = byArea.filter((a) => a._count._all < 3).reduce((s, a) => s + a._count._all, 0);
    const days = decided.map((d) => ((d.closedAt as Date).getTime() - d.createdAt.getTime()) / 864e5);
    const approved = byOutcome.find((o) => o.outcome === "APPROVED")?._count._all ?? 0;
    const rejected = byOutcome.find((o) => o.outcome === "REJECTED")?._count._all ?? 0;
    return {
      total, flagged, small,
      areas: byArea.filter((a) => a._count._all >= 3).map((a) => ({ state: a.state, city: a.city, area: a.area, count: areaCount(a._count._all) })),
      byOutcome: Object.fromEntries(byOutcome.map((o) => [o.outcome, o._count._all])) as Record<string, number>,
      byType: byType.map((t) => ({ type: t.propertyType, count: t._count._all >= 3 ? String(t._count._all) : "fewer than 3" })),
      meanDaysToDecision: days.length ? Math.round((days.reduce((s, x) => s + x, 0) / days.length) * 10) / 10 : null,
      verifiedRate: approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : null,
      rewards: rewards.map((r) => ({ status: r.status, count: r._count._all, kobo: r._sum.amountKobo ?? 0n })),
    };
  });
}
