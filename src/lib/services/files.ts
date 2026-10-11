import { z } from "zod";
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import { assertCan, type Ctx } from "./context";

// Physical file register and document deadlines (master prompt Section 11.3 and Phase 4).

const createSchema = z.object({
  fileNumber: z.string().trim().min(1, "Enter the file number").max(40),
  title: z.string().trim().min(2, "Enter the file title").max(200),
  location: z.string().trim().max(200).default(""),
  departmentId: z.string().optional().transform((v) => v || null),
  assetId: z.string().optional().transform((v) => v || null),
});

export async function createPhysicalFile(ctx: Ctx, input: z.input<typeof createSchema>) {
  assertCan(ctx, "file.manage");
  const data = createSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (data.departmentId && !(await tx.department.findFirst({ where: { id: data.departmentId, companyId: ctx.companyId } }))) {
      throw new Error("That department was not found");
    }
    if (data.assetId && !(await tx.asset.findFirst({ where: { id: data.assetId, companyId: ctx.companyId }, select: { id: true } }))) {
      throw new Error("That asset was not found");
    }
    const exists = await tx.physicalFile.findFirst({ where: { companyId: ctx.companyId, fileNumber: data.fileNumber } });
    if (exists) throw new Error(`File number ${data.fileNumber} is already in the register`);
    const file = await tx.physicalFile.create({ data: { ...data, companyId: ctx.companyId } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "physical_file", entityId: file.id,
      action: "file.registered", detail: { fileNumber: data.fileNumber, title: data.title },
    });
    return file;
  });
}

const issueSchema = z.object({
  holderId: z.string().min(1, "Choose who is taking the file"),
  expectedReturnOn: z.string().transform((v) => parseDateOnly(v)),
  purpose: z.string().trim().max(300).default(""),
});

export async function issuePhysicalFile(ctx: Ctx, fileId: string, input: z.input<typeof issueSchema>) {
  assertCan(ctx, "file.manage");
  const data = issueSchema.parse(input);
  const today = todayInLagos();
  if (data.expectedReturnOn < today) throw new Error("The expected return date cannot be in the past");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM physical_files WHERE id = ${fileId} AND company_id = ${ctx.companyId} FOR UPDATE`;
    if (!locked.length) throw new Error("File not found");
    const file = await tx.physicalFile.findUniqueOrThrow({ where: { id: fileId } });
    if (file.status !== "IN_REGISTRY") throw new Error("This file is not in the registry. Record its return first.");
    const holder = await tx.membership.findFirst({
      where: { id: data.holderId, companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } },
    });
    if (!holder) throw new Error("Issue the file to an active member of your company");
    await tx.fileMovement.create({
      data: { companyId: ctx.companyId, fileId, holderId: holder.id, issuedOn: today, expectedReturnOn: data.expectedReturnOn,
              purpose: data.purpose, issuedById: ctx.userId },
    });
    await tx.physicalFile.update({ where: { id: fileId }, data: { status: "ISSUED", holderId: holder.id } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "physical_file", entityId: fileId,
      action: "file.issued", detail: { to: holder.user.name, expectedReturnOn: data.expectedReturnOn.toISOString().slice(0, 10), purpose: data.purpose },
    });
  });
}

export async function returnPhysicalFile(ctx: Ctx, fileId: string) {
  assertCan(ctx, "file.manage");
  const today = todayInLagos();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM physical_files WHERE id = ${fileId} AND company_id = ${ctx.companyId} FOR UPDATE`;
    if (!locked.length) throw new Error("File not found");
    const file = await tx.physicalFile.findUniqueOrThrow({ where: { id: fileId } });
    if (file.status !== "ISSUED") throw new Error("This file is already in the registry");
    const open = await tx.fileMovement.findFirst({ where: { fileId, companyId: ctx.companyId, returnedOn: null }, orderBy: { createdAt: "desc" } });
    if (open) await tx.fileMovement.update({ where: { id: open.id }, data: { returnedOn: today, receivedById: ctx.userId } });
    await tx.physicalFile.update({ where: { id: fileId }, data: { status: "IN_REGISTRY", holderId: null } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "physical_file", entityId: fileId,
      action: "file.returned", detail: { late: !!open && open.expectedReturnOn < today },
    });
  });
}

export async function listPhysicalFiles(ctx: Ctx, f: { q?: string; view?: string } = {}) {
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const files = await tx.physicalFile.findMany({
      where: {
        companyId: ctx.companyId,
        ...(f.q ? { OR: [{ fileNumber: { contains: f.q, mode: "insensitive" } }, { title: { contains: f.q, mode: "insensitive" } }] } : {}),
        ...(f.view === "issued" ? { status: "ISSUED" as const } : {}),
        ...(f.view === "overdue" ? { status: "ISSUED" as const, movements: { some: { returnedOn: null, expectedReturnOn: { lt: today } } } } : {}),
      },
      orderBy: { fileNumber: "asc" },
      take: 500,
      include: {
        holder: { include: { user: { select: { name: true } } } },
        department: { select: { code: true } },
        asset: { select: { id: true, ref: true } },
        movements: { where: { returnedOn: null }, take: 1, orderBy: { createdAt: "desc" } },
      },
    });
    return files.map((file) => ({ ...file, open: file.movements[0] ?? null, overdue: !!file.movements[0] && file.movements[0].expectedReturnOn < today }));
  });
}

export async function fileMovements(ctx: Ctx, fileId: string) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const moves = await tx.fileMovement.findMany({ where: { fileId, companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 50 });
    const holders = await tx.membership.findMany({
      where: { companyId: ctx.companyId, id: { in: moves.map((m) => m.holderId) } }, include: { user: { select: { name: true } } },
    });
    const names = Object.fromEntries(holders.map((h) => [h.id, h.user.name]));
    return moves.map((m) => ({ ...m, holderName: names[m.holderId] ?? "Former member" }));
  });
}

/** Asset documents that expire within `days`, including those already expired. */
export async function expiringDocuments(ctx: Ctx, days = 60) {
  const limit = new Date(todayInLagos().getTime() + days * 864e5);
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.assetDocument.findMany({
      where: { companyId: ctx.companyId, expiresOn: { lte: limit } },
      orderBy: { expiresOn: "asc" },
      take: 50,
      include: { asset: { select: { id: true, ref: true, name: true } } },
    }));
}

export async function overdueFileCount(ctx: Ctx) {
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.fileMovement.count({ where: { companyId: ctx.companyId, returnedOn: null, expectedReturnOn: { lt: today } } }));
}
