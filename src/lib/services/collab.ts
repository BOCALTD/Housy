import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, withPlatformAdmin, withTenant, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { formatDate, parseDateOnly, todayInLagos } from "../dates";
import { formatKobo } from "../money";
import { validateUpload } from "../storage";
import { randomRef } from "../tokens";
import { can, type Action, type Role } from "../permissions";
import {
  COLLAB_KINDS, COLLAB_PURPOSES, COMPANY_PURPOSES, SEEKER_PURPOSES, dealSnapshot, inviteExpired, inviteExpiry, isOpen, participantActive, participantCan, propertySnapshot,
  transitionProblem, workspaceEnded, workspaceMode, type CollabStatusName, type Need, type PlanAccess, type Snapshot,
} from "../collab-rules";
import { weakest } from "../subscription-rules";
import { readSettings } from "./platform-settings";
import { entitlementIn, type Entitlement, type Owner } from "./subscriptions";
import { notify } from "./notifications";
import { canChangeDeal, loadDeal } from "./deal";
import type { Ctx } from "./context";
import type { Upload } from "./photos";

// Collaboration (master prompt Section 27). Two parties work in a shared workspace. Each can see the invitation and the workspace;
// neither can see the other's own records. Only what a party puts into the workspace is shared, as a copy of the fields it ticked.
// A subscription switches the feature on; it never widens what anyone may see.

/** Who is acting. A company member acts in their company; a seeker (or anyone using their personal account) has no company. */
export type Actor = { userId: string; companyId: string | null; membershipId: string | null; role: Role | null };
export const asCompany = (c: Ctx): Actor => ({ userId: c.userId, companyId: c.companyId, membershipId: c.membershipId, role: c.role });
export const asPerson = (userId: string): Actor => ({ userId, companyId: null, membershipId: null, role: null });

const run = <T>(a: Actor, fn: (tx: Tx) => Promise<T>) => (a.companyId ? withTenant(a.companyId, a.userId, fn) : withUser(a.userId, fn));
const may = (a: Actor, action: Action) => a.role !== null && can(a.role, action);
function must(a: Actor, action: Action) {
  if (!may(a, action)) throw new Error("You do not have permission to do that. Ask your company administrator.");
}
const NOT_FOUND = "Collaboration not found";
const userName = async (tx: Tx, id: string) => (await tx.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "Someone";
const PARTICIPANT_ROLES: Role[] = ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"];

type Collab = Prisma.CollaborationGetPayload<object>;
type Side = "SENDER" | "RECIPIENT";

// ---------- Who may speak for a side ----------

/** The side a person acts for, by account or by company. */
function sideOf(a: Actor, c: Collab): Side | null {
  if (a.userId === c.senderUserId || (a.companyId !== null && a.companyId === c.senderCompanyId)) return "SENDER";
  if (a.userId === c.recipientUserId || (a.companyId !== null && a.companyId === c.recipientCompanyId)) return "RECIPIENT";
  return null;
}
/** Whether this person may speak for a side: the seeker, the invited agent, or a manager or administrator of a company that is a party. */
function speaksFor(a: Actor, c: Collab, side: Side): boolean {
  if (side === "SENDER") {
    if (c.kind === "SEEKER_AGENT") return a.userId === c.senderUserId;
    return a.companyId === c.senderCompanyId && may(a, "collab.company");
  }
  if (c.kind === "SEEKER_AGENT") return a.userId === c.recipientUserId || (a.companyId === c.recipientCompanyId && may(a, "collab.company"));
  return a.companyId === c.recipientCompanyId && may(a, "collab.company");
}
const isSupervisor = (a: Actor, c: Collab) => a.companyId !== null && may(a, "collab.company") && (a.companyId === c.senderCompanyId || a.companyId === c.recipientCompanyId);
const linkFor = (c: Collab, side: Side) => (c.kind === "SEEKER_AGENT" && side === "SENDER" ? `/me/collaborations/${c.id}` : `/app/collaborations/${c.id}`);

async function event(tx: Tx, collaborationId: string, actorId: string | null, kind: string, summary: string) {
  const actorName = actorId ? await userName(tx, actorId) : "Platform";
  await tx.collabEvent.createMany({ data: [{ collaborationId, actorId, actorName, kind, summary: summary.slice(0, 500) }] });
}

async function activeParticipants(tx: Tx, collaborationId: string, side?: Side) {
  const rows = await tx.collabParticipant.findMany({ where: { collaborationId, ...(side ? { side } : {}) } });
  const now = new Date();
  return rows.filter((p) => participantActive(p, now));
}
async function tell(tx: Tx, userIds: string[], except: string, n: { kind: string; title: string; body?: string; link: string }) {
  for (const id of new Set(userIds)) if (id !== except) await notify(tx, id, n);
}

// ---------- Plan state ----------

export interface PlanPart { party: Side; state: Entitlement["state"]; access: PlanAccess; planName: string | null; explanation: string }
export interface PlanView { access: PlanAccess; parts: PlanPart[]; explanation: string; senderLimit: number | null }

const keyFor = (c: Collab) => (c.kind === "SEEKER_AGENT" ? "COLLAB_SEEKER_AGENT" : "COLLAB_COMPANY") as "COLLAB_SEEKER_AGENT" | "COLLAB_COMPANY";
const senderOwner = (c: Pick<Collab, "kind" | "senderUserId" | "senderCompanyId">): Owner => (c.kind === "SEEKER_AGENT" ? { kind: "USER", userId: c.senderUserId } : { kind: "COMPANY", companyId: c.senderCompanyId! });

/**
 * A seeker's workspace follows the seeker's plan. A company pair follows the weaker of the two companies' plans.
 * The explanation says whose plan is the cause, so the person knows what to do.
 */
export async function planFor(tx: Tx, c: Collab, now: Date = new Date()): Promise<PlanView> {
  const key = keyFor(c);
  const s = await entitlementIn(tx, senderOwner(c), key, now);
  const parts: PlanPart[] = [{ party: "SENDER", state: s.state, access: s.access, planName: s.planName, explanation: s.explanation }];
  if (c.kind === "COMPANY_COMPANY") {
    const r = await entitlementIn(tx, { kind: "COMPANY", companyId: c.recipientCompanyId! }, key, now);
    parts.push({ party: "RECIPIENT", state: r.state, access: r.access, planName: r.planName, explanation: r.explanation });
  }
  const access = weakest(...parts.map((p) => p.access));
  const worst = parts.find((p) => p.access === access) ?? parts[0];
  const who = c.kind === "SEEKER_AGENT" ? "The seeker's" : worst.party === "SENDER" ? `${c.senderName}'s` : `${c.recipientName}'s`;
  return { access, parts, senderLimit: s.limit, explanation: access === "FULL" ? "" : `${who} plan: ${worst.explanation}` };
}

// ---------- Loading, settling ----------

async function loadSettled(tx: Tx, a: Actor, id: string): Promise<Collab> {
  const c = await tx.collaboration.findUnique({ where: { id } });
  if (!c) throw new Error(NOT_FOUND);
  // Known to the people named in it, the supervisors of a company involved, and active participants. Nobody else learns it exists.
  const byAccount = a.userId === c.senderUserId || a.userId === c.recipientUserId;
  if (!byAccount && !isSupervisor(a, c)) {
    const p = await tx.collabParticipant.findUnique({ where: { collaborationId_userId: { collaborationId: id, userId: a.userId } } });
    if (!p || !participantActive(p, new Date())) throw new Error(NOT_FOUND);
  }
  return settle(tx, c);
}

/** Close what time has closed: an invitation nobody answered in time, a workspace past its end date. */
async function settle(tx: Tx, c: Collab, now: Date = new Date()): Promise<Collab> {
  if (inviteExpired(c.status as CollabStatusName, c.expiresAt, now)) {
    const u = await tx.collaboration.update({ where: { id: c.id }, data: { status: "EXPIRED", closedAt: now, closeReason: "Nobody answered before the invitation expired" } });
    await event(tx, c.id, null, "expired", "The invitation expired without an answer");
    await tell(tx, [c.senderUserId], "", { kind: "collab.expired", title: "An invitation expired", body: c.title, link: linkFor(c, "SENDER") });
    return u;
  }
  if (workspaceEnded(c.status as CollabStatusName, c.endsOn, todayInLagos(now))) {
    const u = await tx.collaboration.update({ where: { id: c.id }, data: { status: "COMPLETED", closedAt: now, closeReason: "The end date passed" } });
    await event(tx, c.id, null, "completed", "The collaboration reached its end date");
    return u;
  }
  return c;
}

function moveTo(c: Collab, to: CollabStatusName) {
  const problem = transitionProblem(c.status as CollabStatusName, to);
  if (problem) throw new Error(problem);
}

// ---------- Invitations ----------

const inviteSchema = z.object({
  kind: z.enum(COLLAB_KINDS),
  purpose: z.enum(COLLAB_PURPOSES),
  title: z.string().trim().min(3, "Give the collaboration a title").max(160),
  scope: z.string().trim().max(2000).default(""),
  terms: z.string().trim().max(2000).default(""),
  endsOn: z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null)),
  agentUserId: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
});
export type InviteInput = z.input<typeof inviteSchema>;

const OPEN = ["DRAFT", "PENDING", "ACTIVE", "SUSPENDED"] as const;

/** Create an invitation as a draft, or send it straight away. */
export async function createInvitation(a: Actor, raw: InviteInput, send = false) {
  const d = inviteSchema.parse(raw);
  if (d.endsOn && d.endsOn.getTime() < todayInLagos().getTime()) throw new Error("The end date is in the past");
  return run(a, async (tx) => {
    const sender = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { name: true } });
    let data: Prisma.CollaborationUncheckedCreateInput;
    if (d.kind === "SEEKER_AGENT") {
      if (a.companyId) throw new Error("Invite an agent from your personal account, not a company workspace");
      if (!(SEEKER_PURPOSES as readonly string[]).includes(d.purpose)) throw new Error("Choose a purpose that suits a seeker");
      if (!d.agentUserId) throw new Error("Choose the agent to invite");
      if (d.agentUserId === a.userId) throw new Error("You cannot invite yourself");
      const profile = await tx.agentProfile.findFirst({ where: { userId: d.agentUserId, listed: true } });
      if (!profile) throw new Error("That agent is not available to collaborate");
      if (await tx.collaboration.findFirst({ where: { kind: "SEEKER_AGENT", senderUserId: a.userId, recipientUserId: d.agentUserId, status: { in: [...OPEN] } } })) throw new Error("You already have an open collaboration with this agent");
      data = {
        ref: randomRef("COL", 8), kind: "SEEKER_AGENT", purpose: d.purpose, title: d.title, scope: d.scope, terms: d.terms, endsOn: d.endsOn, senderUserId: a.userId, senderName: sender.name,
        recipientUserId: d.agentUserId, recipientCompanyId: profile.companyId, recipientName: profile.companyName ? `${profile.displayName} (${profile.companyName})` : profile.displayName,
      };
    } else {
      if (!a.companyId) throw new Error("Invite a company from your company workspace");
      must(a, "collab.company");
      if (!(COMPANY_PURPOSES as readonly string[]).includes(d.purpose)) throw new Error("Choose a purpose that suits two companies");
      if (!d.companyId) throw new Error("Choose the company to invite");
      if (d.companyId === a.companyId) throw new Error("You cannot invite your own company");
      const target = await tx.companyProfile.findFirst({ where: { companyId: d.companyId, listed: true } });
      if (!target) throw new Error("That company is not available to collaborate");
      const dup = await tx.collaboration.findFirst({ where: { kind: "COMPANY_COMPANY", purpose: d.purpose, status: { in: [...OPEN] }, OR: [{ senderCompanyId: a.companyId, recipientCompanyId: d.companyId }, { senderCompanyId: d.companyId, recipientCompanyId: a.companyId }] } });
      if (dup) throw new Error("These two companies already have an open collaboration for this purpose");
      const mine = await tx.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { name: true } });
      data = {
        ref: randomRef("COL", 8), kind: "COMPANY_COMPANY", purpose: d.purpose, title: d.title, scope: d.scope, terms: d.terms, endsOn: d.endsOn, senderUserId: a.userId, senderCompanyId: a.companyId, senderName: mine.name,
        recipientCompanyId: d.companyId, recipientName: target.displayName,
      };
    }
    const c = await tx.collaboration.create({ data });
    await tx.collabParticipant.create({ data: { collaborationId: c.id, side: "SENDER", userId: a.userId, companyId: a.companyId, name: sender.name, addedById: a.userId } });
    await event(tx, c.id, a.userId, "created", `Invitation drafted for ${c.recipientName}`);
    if (a.companyId) await logActivity(tx, { companyId: a.companyId, actorId: a.userId, entityType: "collaboration", entityId: c.id, action: "collaboration.created", detail: { with: c.recipientName, purpose: c.purpose } });
    if (send) return sendIn(tx, a, c);
    return c;
  });
}

export async function sendInvitation(a: Actor, id: string) {
  return run(a, async (tx) => sendIn(tx, a, await loadSettled(tx, a, id)));
}

async function sendIn(tx: Tx, a: Actor, c: Collab) {
  if (!speaksFor(a, c, "SENDER")) throw new Error("Only the sender can send this invitation");
  moveTo(c, "PENDING");
  const ent = await entitlementIn(tx, senderOwner(c), keyFor(c));
  if (ent.access !== "FULL") throw new Error(`Collaboration is not available on this plan. ${ent.explanation}`);
  if (ent.limit !== null) {
    const used = await tx.collaboration.count({ where: { kind: c.kind, status: { in: ["PENDING", "ACTIVE", "SUSPENDED"] }, ...(c.kind === "SEEKER_AGENT" ? { senderUserId: c.senderUserId } : { senderCompanyId: c.senderCompanyId }) } });
    if (used >= ent.limit) throw new Error(`Your plan allows ${ent.limit} open collaborations and you have ${used}. Finish or cancel one first.`);
  }
  const now = new Date();
  const settings = await readSettings();
  const u = await tx.collaboration.update({ where: { id: c.id }, data: { status: "PENDING", sentAt: now, expiresAt: inviteExpiry(now, settings.inviteExpiryDays) } });
  await event(tx, c.id, a.userId, "sent", `Invitation sent to ${c.recipientName}, open until ${formatDate(u.expiresAt)}`);
  if (c.kind === "SEEKER_AGENT" && c.recipientUserId) await notify(tx, c.recipientUserId, { kind: "collab.invited", title: "Invitation to collaborate", body: `${c.senderName}: ${c.title}`, link: linkFor(c, "RECIPIENT") });
  return u;
}

export async function cancelInvitation(a: Actor, id: string, reasonInput = "") {
  const reason = z.string().trim().max(500).parse(reasonInput);
  return run(a, async (tx) => {
    const c = await loadSettled(tx, a, id);
    if (!speaksFor(a, c, "SENDER")) throw new Error("Only the sender can cancel the invitation");
    moveTo(c, "CANCELLED");
    await tx.collaboration.update({ where: { id }, data: { status: "CANCELLED", closedAt: new Date(), closedById: a.userId, closeReason: reason } });
    await event(tx, id, a.userId, "cancelled", `Invitation cancelled${reason ? `: ${reason}` : ""}`);
    if (c.status === "PENDING" && c.recipientUserId) await notify(tx, c.recipientUserId, { kind: "collab.cancelled", title: "An invitation was cancelled", body: c.title, link: linkFor(c, "RECIPIENT") });
  });
}

/** Accept or decline. Acceptance is explicit, by the other side, and is what first lets anything be shared. */
export async function respondInvitation(a: Actor, id: string, decision: "accept" | "decline", noteInput = "", participantUserIds: string[] = []) {
  const note = z.string().trim().max(500).parse(noteInput);
  return run(a, async (tx) => {
    const c = await loadSettled(tx, a, id);
    const personal = c.kind === "SEEKER_AGENT";
    if (personal ? a.userId !== c.recipientUserId : !speaksFor(a, c, "RECIPIENT")) throw new Error(personal ? "Only the invited agent can answer this invitation" : "Only a manager or administrator of the invited company can answer");
    if (a.userId === c.senderUserId) throw new Error("The other side must answer the invitation");
    if (c.status !== "PENDING") throw new Error(`This invitation is ${c.status.toLowerCase()}, so it cannot be answered`);
    const now = new Date();
    const senderParticipants = await activeParticipants(tx, id, "SENDER");
    if (decision === "decline") {
      await tx.collaboration.update({ where: { id }, data: { status: "DECLINED", respondedAt: now, respondedById: a.userId, responseNote: note, closedAt: now } });
      await event(tx, id, a.userId, "declined", `Invitation declined${note ? `: ${note}` : ""}`);
      await tell(tx, [c.senderUserId, ...senderParticipants.map((p) => p.userId)], a.userId, { kind: "collab.declined", title: "Your invitation was declined", body: c.title, link: linkFor(c, "SENDER") });
      return;
    }
    const plan = await planFor(tx, c, now);
    if (plan.access !== "FULL") throw new Error(`This cannot be accepted yet. ${plan.explanation}`);
    // The people who will work on the recipient's side.
    let people: { userId: string; name: string }[];
    if (personal) {
      people = [{ userId: a.userId, name: await userName(tx, a.userId) }];
    } else {
      const wanted = participantUserIds.length ? [...new Set(participantUserIds)] : [a.userId];
      const members = await tx.membership.findMany({ where: { companyId: a.companyId!, userId: { in: wanted }, status: "ACTIVE", role: { in: PARTICIPANT_ROLES } }, include: { user: { select: { name: true } } } });
      if (members.length !== wanted.length) throw new Error("Choose only active agents, managers or administrators of your company");
      people = members.map((m) => ({ userId: m.userId, name: m.user.name }));
    }
    await tx.collaboration.update({ where: { id }, data: { status: "ACTIVE", respondedAt: now, respondedById: a.userId, responseNote: note } });
    for (const p of people) {
      await tx.collabParticipant.upsert({
        where: { collaborationId_userId: { collaborationId: id, userId: p.userId } },
        create: { collaborationId: id, side: "RECIPIENT", userId: p.userId, companyId: a.companyId, name: p.name, addedById: a.userId },
        update: { revokedAt: null, revokedById: null, revokeReason: "" },
      });
    }
    await event(tx, id, a.userId, "accepted", `Invitation accepted. ${people.map((p) => p.name).join(", ")} can now work in the workspace`);
    await tell(tx, [c.senderUserId, ...senderParticipants.map((p) => p.userId)], a.userId, { kind: "collab.accepted", title: "Your invitation was accepted", body: c.title, link: linkFor(c, "SENDER") });
    if (a.companyId) await logActivity(tx, { companyId: a.companyId, actorId: a.userId, entityType: "collaboration", entityId: id, action: "collaboration.accepted", detail: { with: c.senderName } });
  });
}

/** Finish a collaboration. Either side can; the record stays readable. */
export async function endCollaboration(a: Actor, id: string, noteInput: string) {
  const note = z.string().trim().min(3, "Say why the collaboration is finishing").max(500).parse(noteInput);
  return run(a, async (tx) => {
    const c = await loadSettled(tx, a, id);
    const side = sideOf(a, c);
    if (!side || !speaksFor(a, c, side)) throw new Error("Only the seeker, the agent, or a manager or administrator of a company involved can finish it");
    moveTo(c, "COMPLETED");
    await tx.collaboration.update({ where: { id }, data: { status: "COMPLETED", closedAt: new Date(), closedById: a.userId, closeReason: note } });
    await event(tx, id, a.userId, "completed", `Finished: ${note}`);
    const others = await activeParticipants(tx, id);
    await tell(tx, others.map((p) => p.userId), a.userId, { kind: "collab.completed", title: "A collaboration was finished", body: c.title, link: linkFor(c, side === "SENDER" ? "RECIPIENT" : "SENDER") });
  });
}

/** Stop a workspace for now. Whoever suspends it is the one who can resume it. Nothing is deleted. */
export async function suspendCollaboration(a: Actor, id: string, reasonInput: string) {
  const reason = z.string().trim().min(3, "Say why it is being suspended").max(500).parse(reasonInput);
  return run(a, async (tx) => {
    const c = await loadSettled(tx, a, id);
    const side = sideOf(a, c);
    if (!side || !speaksFor(a, c, side)) throw new Error("Only the seeker, the agent, or a manager or administrator of a company involved can suspend it");
    moveTo(c, "SUSPENDED");
    await tx.collaboration.update({ where: { id }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedById: a.userId, suspendedBy: side, suspendReason: reason } });
    await event(tx, id, a.userId, "suspended", `Suspended: ${reason}`);
    const others = await activeParticipants(tx, id);
    await tell(tx, others.map((p) => p.userId), a.userId, { kind: "collab.suspended", title: "A collaboration was suspended", body: `${c.title}: ${reason}`, link: linkFor(c, side === "SENDER" ? "RECIPIENT" : "SENDER") });
  });
}

export async function resumeCollaboration(a: Actor, id: string) {
  return run(a, async (tx) => {
    const c = await loadSettled(tx, a, id);
    if (c.status !== "SUSPENDED") throw new Error("This collaboration is not suspended");
    if (c.suspendedBy === "PLATFORM") throw new Error("The platform suspended this collaboration. Only the platform administrator can resume it");
    if (!speaksFor(a, c, c.suspendedBy as Side)) throw new Error("Only the side that suspended it can resume it");
    moveTo(c, "ACTIVE");
    await tx.collaboration.update({ where: { id }, data: { status: "ACTIVE", suspendedAt: null, suspendedById: null, suspendedBy: null, suspendReason: "" } });
    await event(tx, id, a.userId, "resumed", "Resumed");
    const others = await activeParticipants(tx, id);
    await tell(tx, others.map((p) => p.userId), a.userId, { kind: "collab.resumed", title: "A collaboration was resumed", body: c.title, link: linkFor(c, c.suspendedBy === "SENDER" ? "RECIPIENT" : "SENDER") });
  });
}

async function adminCheck(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

/** The platform can suspend a collaboration that breaks its rules; only the platform resumes it. */
export async function platformSuspend(adminId: string, id: string, reasonInput: string) {
  await adminCheck(adminId);
  const reason = z.string().trim().min(3, "Say why").max(500).parse(reasonInput);
  return withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.collaboration.findUnique({ where: { id } });
    if (!c) throw new Error(NOT_FOUND);
    moveTo(c, "SUSPENDED");
    await tx.collaboration.update({ where: { id }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedById: adminId, suspendedBy: "PLATFORM", suspendReason: reason } });
    await event(tx, id, adminId, "suspended", `Suspended by the platform: ${reason}`);
    const people = await tx.collabParticipant.findMany({ where: { collaborationId: id, revokedAt: null } });
    for (const p of people) await notify(tx, p.userId, { kind: "collab.suspended", title: "A collaboration was suspended by the platform", body: `${c.title}: ${reason}`, link: linkFor(c, p.side as Side) });
  });
}

export async function platformResume(adminId: string, id: string) {
  await adminCheck(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.collaboration.findUnique({ where: { id } });
    if (!c) throw new Error(NOT_FOUND);
    if (c.status !== "SUSPENDED") throw new Error("This collaboration is not suspended");
    await tx.collaboration.update({ where: { id }, data: { status: "ACTIVE", suspendedAt: null, suspendedById: null, suspendedBy: null, suspendReason: "" } });
    await event(tx, id, adminId, "resumed", "Resumed by the platform");
    const people = await tx.collabParticipant.findMany({ where: { collaborationId: id, revokedAt: null } });
    for (const p of people) await notify(tx, p.userId, { kind: "collab.resumed", title: "A collaboration was resumed", body: c.title, link: linkFor(c, p.side as Side) });
  });
}

export async function adminCollaborations(adminId: string) {
  await adminCheck(adminId);
  return withPlatformAdmin(adminId, (tx) => tx.collaboration.findMany({ orderBy: { updatedAt: "desc" }, take: 200 }));
}

// ---------- People in a workspace ----------

export interface PermInput { canComment?: boolean; canTasks?: boolean; canShare?: boolean; canDocuments?: boolean; expiresOn?: string | null }

/** Add a colleague to the company's side of a company-to-company workspace. A seeker's workspace stays between the seeker and the agent. */
export async function addParticipant(a: Actor, id: string, userId: string, perms: PermInput = {}) {
  return run(a, async (tx) => {
    const c = await loadSettled(tx, a, id);
    if (c.kind === "SEEKER_AGENT") throw new Error("A seeker's workspace stays between the seeker and the agent");
    const side = sideOf(a, c);
    if (!side || !speaksFor(a, c, side)) throw new Error("Only a manager or administrator of the company can add people");
    if (!isOpen(c.status as CollabStatusName)) throw new Error("This collaboration is closed");
    const member = await tx.membership.findFirst({ where: { companyId: a.companyId!, userId, status: "ACTIVE", role: { in: PARTICIPANT_ROLES } }, include: { user: { select: { name: true } } } });
    if (!member) throw new Error("Choose an active agent, manager or administrator of your company");
    const data = {
      canComment: perms.canComment ?? true, canTasks: perms.canTasks ?? true, canShare: perms.canShare ?? true, canDocuments: perms.canDocuments ?? true,
      expiresAt: perms.expiresOn ? new Date(parseDateOnly(perms.expiresOn).getTime() + 864e5 - 1) : null,
    };
    if (data.expiresAt && data.expiresAt.getTime() <= Date.now()) throw new Error("Choose an access end date in the future");
    const p = await tx.collabParticipant.upsert({
      where: { collaborationId_userId: { collaborationId: id, userId } },
      create: { collaborationId: id, side, userId, companyId: a.companyId, name: member.user.name, addedById: a.userId, ...data },
      update: { ...data, revokedAt: null, revokedById: null, revokeReason: "" },
    });
    await event(tx, id, a.userId, "participant_added", `${member.user.name} was given access`);
    await notify(tx, userId, { kind: "collab.added", title: "You were added to a collaboration", body: c.title, link: linkFor(c, side) });
    return p;
  });
}

export async function updateParticipant(a: Actor, participantId: string, perms: PermInput) {
  return run(a, async (tx) => {
    const p = await tx.collabParticipant.findUnique({ where: { id: participantId } });
    if (!p) throw new Error(NOT_FOUND);
    const c = await loadSettled(tx, a, p.collaborationId);
    if (!speaksFor(a, c, p.side as Side)) throw new Error("Only a manager or administrator of that side can change access");
    if (p.revokedAt) throw new Error("Access was revoked. Add the person again to restore it");
    const expiresAt = perms.expiresOn === undefined ? undefined : perms.expiresOn ? new Date(parseDateOnly(perms.expiresOn).getTime() + 864e5 - 1) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new Error("Choose an access end date in the future");
    await tx.collabParticipant.update({ where: { id: p.id }, data: { canComment: perms.canComment ?? p.canComment, canTasks: perms.canTasks ?? p.canTasks, canShare: perms.canShare ?? p.canShare, canDocuments: perms.canDocuments ?? p.canDocuments, ...(expiresAt === undefined ? {} : { expiresAt }) } });
    await event(tx, c.id, a.userId, "participant_changed", `Access changed for ${p.name}`);
  });
}

/** Take someone's access away. It takes effect on their next request. They can also leave themselves. */
export async function revokeParticipant(a: Actor, participantId: string, reasonInput: string) {
  const reason = z.string().trim().min(3, "Say why access is being removed").max(500).parse(reasonInput);
  return run(a, async (tx) => {
    const p = await tx.collabParticipant.findUnique({ where: { id: participantId } });
    if (!p) throw new Error(NOT_FOUND);
    const c = await loadSettled(tx, a, p.collaborationId);
    if (!(p.userId === a.userId || speaksFor(a, c, p.side as Side))) throw new Error("Only a manager or administrator of that side can remove someone");
    if (p.revokedAt) throw new Error("That access was already removed");
    await tx.collabParticipant.update({ where: { id: p.id }, data: { revokedAt: new Date(), revokedById: a.userId, revokeReason: reason } });
    await event(tx, c.id, a.userId, "participant_revoked", `${p.name} no longer has access: ${reason}`);
    if (p.userId !== a.userId) await notify(tx, p.userId, { kind: "collab.revoked", title: "Your access to a collaboration was removed", body: c.title, link: linkFor(c, p.side as Side) });
  });
}

// ---------- Working in a workspace ----------

interface Work { c: Collab; me: Prisma.CollabParticipantGetPayload<object>; plan: PlanView; mode: ReturnType<typeof workspaceMode> }

/** Open a workspace for work: the person must be an active participant, the workspace live, the plan in force, and the permission held. */
async function open(tx: Tx, a: Actor, id: string, need: Need, write: boolean): Promise<Work> {
  const c = await loadSettled(tx, a, id);
  const me = await tx.collabParticipant.findUnique({ where: { collaborationId_userId: { collaborationId: id, userId: a.userId } } });
  if (!me || !participantActive(me, new Date())) throw new Error(NOT_FOUND);
  const plan = await planFor(tx, c);
  const mode = workspaceMode(c.status as CollabStatusName, plan.access);
  if (!mode.view) throw new Error(mode.reason || plan.explanation);
  if (write) {
    if (!mode.write) throw new Error(plan.explanation || mode.reason);
    if (!participantCan(me, need)) throw new Error("You were not given permission to do that in this workspace");
  }
  return { c, me, plan, mode };
}

const fieldsJson = (s: Snapshot, options: Record<string, unknown>) => ({ fields: s.fields, options }) as unknown as Prisma.InputJsonValue;

async function announceItem(tx: Tx, a: Actor, c: Collab, side: Side, title: string) {
  const others = await activeParticipants(tx, c.id, side === "SENDER" ? "RECIPIENT" : "SENDER");
  await tell(tx, others.map((p) => p.userId), a.userId, { kind: "collab.shared", title: "Something was shared with you", body: `${c.title}: ${title}`, link: linkFor(c, side === "SENDER" ? "RECIPIENT" : "SENDER") });
}

const propertySchema = z.object({
  listingRef: z.string().trim().optional(), assetId: z.string().trim().optional(),
  address: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  price: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  note: z.string().trim().max(500).default(""),
});

type PropertySource = { snapshot: Snapshot; sourceType: string; sourceId: string };

async function propertyFrom(tx: Tx, a: Actor, o: { listingRef?: string; assetId?: string; address: boolean; price: boolean; note: string }): Promise<PropertySource> {
  if (o.listingRef) {
    const l = await tx.listing.findFirst({ where: { publicRef: o.listingRef, status: "PUBLISHED" } });
    if (!l) throw new Error("That listing is not published");
    return { snapshot: propertySnapshot({ name: l.title, assetClass: "", category: "", city: l.city, state: l.state, address: "", priceKobo: l.priceKobo, purpose: l.purpose, bedrooms: l.bedrooms, bathrooms: l.bathrooms }, { address: false, price: true, note: o.note }, formatKobo), sourceType: "listing", sourceId: l.publicRef };
  }
  if (!o.assetId) throw new Error("Choose a property to share");
  must(a, "asset.view");
  const asset = await tx.asset.findFirst({ where: { id: o.assetId, companyId: a.companyId! }, include: { listing: true } });
  if (!asset) throw new Error("Property not found");
  return {
    snapshot: propertySnapshot({ name: asset.name, assetClass: asset.assetClass, category: asset.category, city: asset.city ?? "", state: asset.state ?? "", address: asset.address ?? "", priceKobo: asset.listing?.priceKobo ?? null, purpose: asset.listing?.purpose, bedrooms: asset.listing?.bedrooms ?? null, bathrooms: asset.listing?.bathrooms ?? null }, { address: o.address, price: o.price, note: o.note }, formatKobo),
    sourceType: "asset", sourceId: asset.id,
  };
}

/** Add a property to the shortlist: a published listing (public information) or one of the company's own properties. */
export async function shareProperty(a: Actor, id: string, raw: z.input<typeof propertySchema>) {
  const o = propertySchema.parse(raw);
  return run(a, async (tx) => {
    const w = await open(tx, a, id, "SHARE", true);
    const side = w.me.side as Side;
    const src = await propertyFrom(tx, a, { ...o, address: o.address, price: o.price });
    if (await tx.collabItem.findFirst({ where: { collaborationId: id, kind: "PROPERTY", sourceType: src.sourceType, sourceId: src.sourceId, revokedAt: null } })) throw new Error("That property is already in the workspace");
    const item = await tx.collabItem.create({ data: { collaborationId: id, kind: "PROPERTY", title: src.snapshot.title, summary: src.snapshot.summary, details: fieldsJson(src.snapshot, { address: o.address, price: o.price, note: o.note }), sourceType: src.sourceType, sourceId: src.sourceId, side, sharedById: a.userId, sharedByName: w.me.name, sharedByCompanyId: a.companyId } });
    await event(tx, id, a.userId, "shared", `${w.me.name} shared a property: ${src.snapshot.title}`);
    if (a.companyId) await logActivity(tx, { companyId: a.companyId, actorId: a.userId, entityType: "collaboration", entityId: id, action: "collaboration.shared_property", detail: { sourceType: src.sourceType } });
    await announceItem(tx, a, w.c, side, src.snapshot.title);
    return item;
  });
}

const dealSchema = z.object({
  dealId: z.string().trim().min(1, "Choose a deal"),
  stage: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  asking: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  agreed: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  expectedClose: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  propertyAddress: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  note: z.string().trim().max(500).default(""),
});

async function dealSnapshotFor(tx: Tx, a: Actor, dealId: string, o: z.output<typeof dealSchema>) {
  const ctx: Ctx = { userId: a.userId, companyId: a.companyId!, membershipId: a.membershipId!, role: a.role! };
  const deal = await loadDeal(tx, ctx, dealId);
  if (!canChangeDeal(ctx, deal)) throw new Error("Only the deal's owner or a manager can share it");
  const asset = await tx.asset.findFirstOrThrow({ where: { id: deal.assetId, companyId: a.companyId! } });
  const snapshot = dealSnapshot(
    { title: deal.title, type: deal.type, stage: deal.stage, askingKobo: deal.askingKobo, agreedKobo: deal.agreedKobo, expectedCloseOn: deal.expectedCloseOn },
    { name: asset.name, assetClass: asset.assetClass, category: asset.category, city: asset.city ?? "", state: asset.state ?? "", address: asset.address ?? "" },
    { stage: o.stage, asking: o.asking, agreed: o.agreed, expectedClose: o.expectedClose, propertyAddress: o.propertyAddress, note: o.note }, formatKobo, formatDate,
  );
  return { snapshot, deal };
}

/** Share a summary of a deal. Only the fields ticked are copied. The client, the other deal terms and the rest of the CRM are never offered. */
export async function shareDeal(a: Actor, id: string, raw: z.input<typeof dealSchema>) {
  const o = dealSchema.parse(raw);
  if (!a.companyId || !a.membershipId || !a.role) throw new Error("Only a company member can share a deal");
  must(a, "crm.view");
  return run(a, async (tx) => {
    const w = await open(tx, a, id, "SHARE", true);
    if (w.c.kind !== "COMPANY_COMPANY") throw new Error("Deals are shared between companies, not with a seeker");
    const { snapshot, deal } = await dealSnapshotFor(tx, a, o.dealId, o);
    if (await tx.collabItem.findFirst({ where: { collaborationId: id, kind: "DEAL_SUMMARY", sourceType: "deal", sourceId: deal.id, revokedAt: null } })) throw new Error("That deal is already shared. Refresh it to update what the other company sees");
    const side = w.me.side as Side;
    const item = await tx.collabItem.create({ data: { collaborationId: id, kind: "DEAL_SUMMARY", title: snapshot.title, summary: snapshot.summary, details: fieldsJson(snapshot, { stage: o.stage, asking: o.asking, agreed: o.agreed, expectedClose: o.expectedClose, propertyAddress: o.propertyAddress, note: o.note }), sourceType: "deal", sourceId: deal.id, side, sharedById: a.userId, sharedByName: w.me.name, sharedByCompanyId: a.companyId } });
    await event(tx, id, a.userId, "shared", `${w.me.name} shared a deal summary: ${snapshot.title}`);
    await logActivity(tx, { companyId: a.companyId, actorId: a.userId, entityType: "deal", entityId: deal.id, action: "deal.shared_to_collaboration", detail: { collaboration: w.c.ref, with: side === "SENDER" ? w.c.recipientName : w.c.senderName, fields: Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] === true) } });
    await announceItem(tx, a, w.c, side, snapshot.title);
    return item;
  });
}

const noteSchema = z.object({ title: z.string().trim().min(2, "Give the note a title").max(160), body: z.string().trim().min(1, "Write the note").max(2000) });
export async function shareNote(a: Actor, id: string, raw: z.input<typeof noteSchema>) {
  const o = noteSchema.parse(raw);
  return run(a, async (tx) => {
    const w = await open(tx, a, id, "SHARE", true);
    const side = w.me.side as Side;
    const item = await tx.collabItem.create({ data: { collaborationId: id, kind: "NOTE", title: o.title, summary: o.body, details: { fields: [], options: {} }, side, sharedById: a.userId, sharedByName: w.me.name, sharedByCompanyId: a.companyId } });
    await event(tx, id, a.userId, "shared", `${w.me.name} shared a note: ${o.title}`);
    await announceItem(tx, a, w.c, side, o.title);
    return item;
  });
}

export async function shareDocument(a: Actor, id: string, titleInput: string, file: Upload) {
  const title = z.string().trim().min(2, "Give the document a title").max(160).parse(titleInput);
  validateUpload(file.type, file.bytes);
  return run(a, async (tx) => {
    const w = await open(tx, a, id, "DOCUMENTS", true);
    const side = w.me.side as Side;
    const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "docx";
    const key = `${randomUUID()}.${ext}`;
    await tx.collabFile.create({ data: { key, collaborationId: id, bytes: Buffer.from(file.bytes) }, select: { key: true } });
    const item = await tx.collabItem.create({ data: { collaborationId: id, kind: "DOCUMENT", title, summary: "", details: { fields: [], options: {} }, side, sharedById: a.userId, sharedByName: w.me.name, sharedByCompanyId: a.companyId, fileKey: key, fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength } });
    await event(tx, id, a.userId, "shared", `${w.me.name} shared a document: ${title}`);
    if (a.companyId) await logActivity(tx, { companyId: a.companyId, actorId: a.userId, entityType: "collaboration", entityId: id, action: "collaboration.shared_document", detail: { title } });
    await announceItem(tx, a, w.c, side, title);
    return item;
  });
}

/** Read a shared document. Opening it is recorded. */
export async function getSharedFile(a: Actor, itemId: string) {
  return run(a, async (tx) => {
    const item = await tx.collabItem.findUnique({ where: { id: itemId } });
    if (!item) return null;
    let w: Work;
    try { w = await open(tx, a, item.collaborationId, "VIEW", false); } catch { return null; }
    if (item.revokedAt || !item.fileKey) return null;
    const f = await tx.collabFile.findUnique({ where: { key: item.fileKey } });
    if (!f) return null;
    await event(tx, w.c.id, a.userId, "document_opened", `${w.me.name} opened ${item.title}`);
    return { item, bytes: Buffer.from(f.bytes) };
  });
}

/** Bring a shared deal or property up to date, using the same fields the sharer ticked the first time. */
export async function refreshItem(a: Actor, itemId: string) {
  return run(a, async (tx) => {
    const item = await tx.collabItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("Shared item not found");
    const w = await open(tx, a, item.collaborationId, "SHARE", true);
    if (item.revokedAt) throw new Error("This was revoked, so it cannot be refreshed");
    if (!(item.sharedById === a.userId || (a.companyId !== null && item.sharedByCompanyId === a.companyId && may(a, "collab.company")))) throw new Error("Only the side that shared this can refresh it");
    const opts = ((item.details as { options?: Record<string, unknown> } | null)?.options ?? {}) as Record<string, unknown>;
    let snapshot: Snapshot;
    if (item.kind === "DEAL_SUMMARY" && item.sourceType === "deal") {
      snapshot = (await dealSnapshotFor(tx, a, item.sourceId, dealSchema.parse({ dealId: item.sourceId, ...opts }))).snapshot;
    } else if (item.kind === "PROPERTY") {
      const src = await propertyFrom(tx, a, item.sourceType === "listing" ? { listingRef: item.sourceId, address: false, price: true, note: String(opts.note ?? "") } : { assetId: item.sourceId, address: opts.address === true, price: opts.price === true, note: String(opts.note ?? "") });
      snapshot = src.snapshot;
    } else {
      throw new Error("Only a shared deal or property can be refreshed");
    }
    await tx.collabItem.update({ where: { id: item.id }, data: { title: snapshot.title, summary: snapshot.summary, details: fieldsJson(snapshot, opts), version: { increment: 1 } } });
    await event(tx, w.c.id, a.userId, "refreshed", `${w.me.name} refreshed ${snapshot.title}`);
  });
}

/** Take something back. The copy is wiped, so the other side can no longer read it. This works even when the plan has lapsed. */
export async function revokeItem(a: Actor, itemId: string, reasonInput: string) {
  const reason = z.string().trim().min(3, "Say why you are taking this back").max(500).parse(reasonInput);
  return run(a, async (tx) => {
    const item = await tx.collabItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("Shared item not found");
    const c = await loadSettled(tx, a, item.collaborationId);
    const owner = item.sharedById === a.userId || (a.companyId !== null && item.sharedByCompanyId === a.companyId && may(a, "collab.company"));
    if (!owner) throw new Error("Only the side that shared this can take it back");
    if (item.revokedAt) throw new Error("This was already taken back");
    if (item.fileKey) await tx.collabFile.deleteMany({ where: { key: item.fileKey } });
    await tx.collabItem.update({ where: { id: item.id }, data: { title: "Revoked item", summary: "", details: {}, sourceId: "", fileKey: null, revokedAt: new Date(), revokedById: a.userId, revokeReason: reason } });
    await event(tx, c.id, a.userId, "revoked", `${await userName(tx, a.userId)} took back "${item.title}": ${reason}`);
    if (a.companyId) await logActivity(tx, { companyId: a.companyId, actorId: a.userId, entityType: "collaboration", entityId: c.id, action: "collaboration.revoked_item", detail: { kind: item.kind } });
  });
}

const taskSchema = z.object({
  title: z.string().trim().min(3, "Enter a short title").max(200),
  description: z.string().trim().max(2000).default(""),
  milestone: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  assigneeId: z.string().trim().optional().transform((v) => v || null),
  dueOn: z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null)),
});

export async function addTask(a: Actor, id: string, raw: z.input<typeof taskSchema>) {
  const d = taskSchema.parse(raw);
  return run(a, async (tx) => {
    const w = await open(tx, a, id, "TASKS", true);
    let assigneeName = "";
    if (d.assigneeId) {
      const p = await tx.collabParticipant.findUnique({ where: { collaborationId_userId: { collaborationId: id, userId: d.assigneeId } } });
      if (!p || !participantActive(p, new Date())) throw new Error("The task can only go to someone in the workspace");
      assigneeName = p.name;
    }
    const t = await tx.collabTask.create({ data: { collaborationId: id, title: d.title, description: d.description, milestone: d.milestone, assigneeId: d.assigneeId, assigneeName, dueOn: d.dueOn, createdById: a.userId, createdByName: w.me.name } });
    await event(tx, id, a.userId, d.milestone ? "milestone_added" : "task_added", `${w.me.name} added ${d.milestone ? "a milestone" : "a task"}: ${d.title}`);
    if (d.assigneeId) await notify(tx, d.assigneeId, { kind: "collab.task", title: "A task was given to you", body: `${w.c.title}: ${d.title}`, link: linkFor(w.c, (await tx.collabParticipant.findUniqueOrThrow({ where: { collaborationId_userId: { collaborationId: id, userId: d.assigneeId } } })).side as Side) });
    return t;
  });
}

export async function setTaskStatus(a: Actor, taskId: string, status: "DONE" | "OPEN" | "CANCELLED", outcomeInput = "") {
  const outcome = z.string().trim().max(1000).parse(outcomeInput);
  return run(a, async (tx) => {
    const t = await tx.collabTask.findUnique({ where: { id: taskId } });
    if (!t) throw new Error("Task not found");
    const w = await open(tx, a, t.collaborationId, "TASKS", true);
    if (status === "DONE" && outcome.length < 3) throw new Error("Say what was done");
    await tx.collabTask.update({ where: { id: t.id }, data: { status, outcome: status === "OPEN" ? "" : outcome, completedAt: status === "DONE" ? new Date() : null } });
    await event(tx, t.collaborationId, a.userId, "task_" + status.toLowerCase(), `${w.me.name} marked "${t.title}" ${status.toLowerCase()}`);
  });
}

export async function addComment(a: Actor, id: string, bodyInput: string, itemId?: string) {
  const body = z.string().trim().min(1, "Write a comment").max(2000).parse(bodyInput);
  return run(a, async (tx) => {
    const w = await open(tx, a, id, "COMMENT", true);
    if (itemId) {
      const item = await tx.collabItem.findFirst({ where: { id: itemId, collaborationId: id, revokedAt: null } });
      if (!item) throw new Error("That item is not in this workspace");
    }
    return tx.collabComment.create({ data: { collaborationId: id, itemId: itemId ?? null, authorId: a.userId, authorName: w.me.name, body } });
  });
}

// ---------- Reading ----------

/** A workspace as one person may see it. Content needs an active participant; a supervisor of a party company sees the roster and history only. */
export async function getWorkspace(a: Actor, id: string) {
  return run(a, async (tx) => {
    const c = await loadSettled(tx, a, id);
    const now = new Date();
    const side = sideOf(a, c);
    const [participants, plan, myRow] = await Promise.all([
      tx.collabParticipant.findMany({ where: { collaborationId: id }, orderBy: [{ side: "asc" }, { createdAt: "asc" }] }),
      planFor(tx, c, now),
      tx.collabParticipant.findUnique({ where: { collaborationId_userId: { collaborationId: id, userId: a.userId } } }),
    ]);
    const me = myRow && participantActive(myRow, now) ? myRow : null;
    const supervisor = isSupervisor(a, c);
    const mode = workspaceMode(c.status as CollabStatusName, plan.access);
    const showContent = !!me && mode.view;
    const events = await tx.collabEvent.findMany({ where: { collaborationId: id }, orderBy: { createdAt: "desc" }, take: 100 });
    const [items, tasks, comments] = showContent
      ? await Promise.all([
          tx.collabItem.findMany({ where: { collaborationId: id }, orderBy: { createdAt: "desc" } }),
          tx.collabTask.findMany({ where: { collaborationId: id }, orderBy: [{ status: "asc" }, { dueOn: "asc" }] }),
          tx.collabComment.findMany({ where: { collaborationId: id }, orderBy: { createdAt: "asc" }, take: 300 }),
        ])
      : [[], [], []];
    return {
      collab: c, side, me, supervisor, participants, plan, mode, items, tasks, comments, events,
      contentHidden: !showContent,
      canWrite: !!me && mode.write,
      can: me ? { comment: participantCan(me, "COMMENT"), tasks: participantCan(me, "TASKS"), share: participantCan(me, "SHARE"), documents: participantCan(me, "DOCUMENTS") } : { comment: false, tasks: false, share: false, documents: false },
      speaks: { sender: speaksFor(a, c, "SENDER"), recipient: speaksFor(a, c, "RECIPIENT") },
      mayAnswer: c.status === "PENDING" && (c.kind === "SEEKER_AGENT" ? a.userId === c.recipientUserId : speaksFor(a, c, "RECIPIENT")) && a.userId !== c.senderUserId,
    };
  });
}

export interface ListedCollab { c: Collab; side: Side | null; otherName: string; needsAnswer: boolean }

export async function listCollaborations(a: Actor) {
  return run(a, async (tx) => {
    const now = new Date();
    const raw = await tx.collaboration.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
    const mine = await tx.collabParticipant.findMany({ where: { userId: a.userId, revokedAt: null }, select: { collaborationId: true } });
    const participating = new Set(mine.map((m) => m.collaborationId));
    const rows: ListedCollab[] = [];
    for (const r of raw) {
      const side = sideOf(a, r);
      const visible = isSupervisor(a, r) || a.userId === r.senderUserId || a.userId === r.recipientUserId || participating.has(r.id);
      if (!visible) continue;
      const c = await settle(tx, r, now);
      const needsAnswer = c.status === "PENDING" && (c.kind === "SEEKER_AGENT" ? a.userId === c.recipientUserId : speaksFor(a, c, "RECIPIENT")) && a.userId !== c.senderUserId;
      rows.push({ c, side, otherName: side === "SENDER" ? c.recipientName : c.senderName, needsAnswer });
    }
    return {
      toAnswer: rows.filter((r) => r.needsAnswer),
      active: rows.filter((r) => r.c.status === "ACTIVE" || r.c.status === "SUSPENDED"),
      sent: rows.filter((r) => (r.c.status === "PENDING" || r.c.status === "DRAFT") && !r.needsAnswer),
      closed: rows.filter((r) => ["DECLINED", "EXPIRED", "CANCELLED", "COMPLETED"].includes(r.c.status)),
    };
  });
}

export async function pendingIncoming(a: Actor): Promise<number> {
  if (a.companyId && !may(a, "collab.company")) return 0;
  return run(a, async (tx) => tx.collaboration.count({
    where: { status: "PENDING", expiresAt: { gt: new Date() }, NOT: { senderUserId: a.userId }, ...(a.companyId ? { recipientCompanyId: a.companyId, kind: "COMPANY_COMPANY" } : { recipientUserId: a.userId }) },
  }));
}

/** Companies this one could invite: listed profiles other than its own. */
export async function inviteableCompanies(a: Actor) {
  return run(a, (tx) => tx.companyProfile.findMany({ where: { listed: true, ...(a.companyId ? { companyId: { not: a.companyId } } : {}) }, orderBy: { displayName: "asc" }, take: 200, select: { companyId: true, displayName: true, kind: true } }));
}
export async function myColleagues(a: Actor) {
  if (!a.companyId) return [];
  return run(a, async (tx) => (await tx.membership.findMany({ where: { companyId: a.companyId!, status: "ACTIVE", role: { in: PARTICIPANT_ROLES } }, include: { user: { select: { name: true } } } })).map((m) => ({ userId: m.userId, name: m.user.name })));
}
export async function myDealChoices(a: Actor) {
  if (!a.companyId || !a.role || !may(a, "crm.view")) return [];
  return run(a, async (tx) => {
    const ctx: Ctx = { userId: a.userId, companyId: a.companyId!, membershipId: a.membershipId!, role: a.role! };
    const { dealVisibleWhere } = await import("./deal");
    const { visibleOwners } = await import("./crm");
    const owners = await visibleOwners(tx, ctx);
    return tx.deal.findMany({ where: { companyId: a.companyId!, status: { in: ["OPEN", "ON_HOLD", "COMPLETED"] }, AND: [dealVisibleWhere(ctx, owners)], ...(may(a, "crm.approve") ? {} : { ownerId: a.membershipId! }) }, select: { id: true, ref: true, title: true }, orderBy: { updatedAt: "desc" }, take: 100 });
  });
}
export async function myAssetChoices(a: Actor) {
  if (!a.companyId || !may(a, "asset.view")) return [];
  return run(a, (tx) => tx.asset.findMany({ where: { companyId: a.companyId!, status: { notIn: ["DISPOSED", "ARCHIVED"] } }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" }, take: 300 }));
}

// ---------- Company audit report ----------

/** For managers and administrators: what their company's collaborations look like, and what it shared and took back. */
export async function collaborationReport(a: Actor) {
  must(a, "collab.company");
  return run(a, async (tx) => {
    const cs = await tx.collaboration.findMany({ where: { OR: [{ senderCompanyId: a.companyId! }, { recipientCompanyId: a.companyId! }] }, orderBy: { updatedAt: "desc" }, take: 500 });
    const ids = cs.map((c) => c.id);
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const c of cs) { byStatus[c.status] = (byStatus[c.status] ?? 0) + 1; byKind[c.kind] = (byKind[c.kind] ?? 0) + 1; }
    const planHeld: string[] = [];
    for (const c of cs.filter((x) => x.status === "ACTIVE")) if ((await planFor(tx, c)).access !== "FULL") planHeld.push(c.id);
    const [shared, revoked, events] = await Promise.all([
      tx.collabItem.count({ where: { collaborationId: { in: ids }, sharedByCompanyId: a.companyId! } }),
      tx.collabItem.count({ where: { collaborationId: { in: ids }, sharedByCompanyId: a.companyId!, revokedAt: { not: null } } }),
      tx.collabEvent.findMany({ where: { collaborationId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 60 }),
    ]);
    const refs = Object.fromEntries(cs.map((c) => [c.id, { ref: c.ref, title: c.title }]));
    return { total: cs.length, byStatus, byKind, planHeld: planHeld.length, itemsShared: shared, itemsRevoked: revoked, events, refs };
  });
}
