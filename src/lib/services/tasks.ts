import { z } from "zod";
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly } from "../dates";
import { can } from "../permissions";
import { assertCan, type Ctx } from "./context";

export const TASK_KINDS = ["TASK", "INSPECTION", "MAINTENANCE"] as const;
export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

const createSchema = z.object({
  kind: z.enum(TASK_KINDS),
  title: z.string().trim().min(3, "Enter a short title").max(200),
  description: z.string().trim().max(5000).default(""),
  priority: z.enum(TASK_PRIORITIES).default("NORMAL"),
  assigneeId: z.string().optional().transform((v) => v || null),
  dueOn: z.string().optional().transform((v) => (v ? parseDateOnly(v) : null)),
});

export async function createTask(ctx: Ctx, assetId: string, input: z.input<typeof createSchema>) {
  assertCan(ctx, "task.create");
  const data = createSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId } });
    if (!asset) throw new Error("Asset not found");
    if (data.assigneeId) {
      const assignee = await tx.membership.findFirst({
        where: { id: data.assigneeId, companyId: ctx.companyId, status: "ACTIVE" },
      });
      if (!assignee) throw new Error("Assign the task to an active member of your company");
    }
    const task = await tx.task.create({
      data: { companyId: ctx.companyId, assetId, kind: data.kind, title: data.title, description: data.description,
              priority: data.priority, assigneeId: data.assigneeId, dueOn: data.dueOn, createdById: ctx.userId },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "task", entityId: task.id,
      action: "task.created", detail: { kind: data.kind, title: data.title, priority: data.priority },
    });
    return task;
  });
}

/** Update a task's status. Managers can update any task; others only tasks assigned to them. */
export async function updateTaskStatus(ctx: Ctx, taskId: string, status: string, outcome: string) {
  const parsed = z.enum(TASK_STATUSES).parse(status);
  if (parsed === "DONE" && outcome.trim().length < 3) {
    throw new Error("Record the outcome before marking the task done");
  }
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, companyId: ctx.companyId } });
    if (!task) throw new Error("Task not found");
    const isAssignee = task.assigneeId === ctx.membershipId;
    if (!isAssignee && !can(ctx.role, "task.update.any")) {
      throw new Error("Only the assignee or a manager can update this task");
    }
    await tx.task.update({ where: { id: task.id }, data: { status: parsed, outcome: outcome.trim() || task.outcome } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "task", entityId: task.id,
      action: "task.status_changed", detail: { from: task.status, to: parsed, outcome: outcome.trim() },
    });
  });
}
