import { prisma, withPlatformAdmin, withTenant } from "../db";
import { logActivity } from "../audit";
import { AI_FEATURES, DEFAULT_AI_CONFIG, aiConfigProblem, type AiConfig, type AiFeature } from "../ai-rules";
import { configuredAi, type AiProvider } from "../ai-provider";
import { assertCan, type Ctx } from "./context";

/**
 * The gate every assisted feature goes through. It checks who may use it and how much, runs the AI service when one is connected
 * and allowed, falls back to the built-in rules when it is not or when it fails, and writes an audit record either way.
 * Nothing here gives the service access to data: callers pass in only the text the person is already allowed to see.
 */

const CONFIG_KEY = "ai_config";
const TIMEOUT_MS = 15_000;
const system = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);

async function assertAdmin(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

export async function readAiConfig(): Promise<AiConfig> {
  const r = await prisma.platformSetting.findUnique({ where: { key: CONFIG_KEY } });
  if (!r) return DEFAULT_AI_CONFIG;
  try {
    const c: AiConfig = { ...DEFAULT_AI_CONFIG, ...(JSON.parse(r.value) as Partial<AiConfig>) };
    return aiConfigProblem(c) ? DEFAULT_AI_CONFIG : c;
  } catch { return DEFAULT_AI_CONFIG; }
}

export async function saveAiConfig(adminId: string, raw: { enabled: boolean; perUserPerDay: string; perCompanyPerMonth: string; publicPerDay: string }) {
  await assertAdmin(adminId);
  const c: AiConfig = { enabled: raw.enabled, perUserPerDay: Number(raw.perUserPerDay), perCompanyPerMonth: Number(raw.perCompanyPerMonth), publicPerDay: Number(raw.publicPerDay) };
  const problem = aiConfigProblem(c);
  if (problem) throw new Error(problem);
  await system(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: JSON.stringify(c), updatedById: adminId }, update: { value: JSON.stringify(c), updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "ai_config", entityId: CONFIG_KEY, action: "ai.config_saved", detail: { ...c } });
  });
  return c;
}

export const aiProvider = (): AiProvider | null => configuredAi();

export interface Actor { userId?: string | null; companyId?: string | null; visitorKey?: string }
export interface Deps { provider?: AiProvider | null; now?: Date }
export interface AiOutcome<T> { result: T; source: "AI" | "RULES"; notice: string }

export interface RunSpec<T> {
  actor: Actor;
  feature: AiFeature;
  subject?: { type: string; id: string };
  inputChars: number;
  /** Always works, needs no service. */
  rules: () => Promise<T> | T;
  /** Optional help from the service. Returns null when its answer is unusable. Must only use text the actor may see. */
  assist?: (provider: AiProvider, signal: AbortSignal) => Promise<T | null>;
  deps?: Deps;
}

async function used(actor: Actor, since: Date, scope: "user" | "company" | "visitor"): Promise<number> {
  const where = scope === "user" ? { userId: actor.userId ?? "-" } : scope === "company" ? { companyId: actor.companyId ?? "-" } : { visitorKey: actor.visitorKey || "-", userId: null };
  return system((tx) => tx.aiRun.count({ where: { ...where, createdAt: { gte: since }, status: { in: ["OK", "ERROR"] } } }));
}

async function audit(a: { actor: Actor; feature: AiFeature; provider: string; status: "OK" | "FALLBACK" | "ERROR" | "LIMITED" | "DENIED"; inputChars: number; outputChars: number; ms: number; subject?: { type: string; id: string }; note: string }) {
  try {
    await system((tx) => tx.aiRun.create({ data: { companyId: a.actor.companyId ?? null, userId: a.actor.userId ?? null, visitorKey: (a.actor.visitorKey ?? "").slice(0, 64), feature: a.feature, provider: a.provider, status: a.status, inputChars: a.inputChars, outputChars: a.outputChars, ms: a.ms, subjectType: a.subject?.type ?? "", subjectId: a.subject?.id ?? "", note: a.note.slice(0, 300) } }));
  } catch (e) {
    console.error("AI audit record could not be written", e);
  }
}

const size = (v: unknown) => { try { return JSON.stringify(v)?.length ?? 0; } catch { return 0; } };

export async function runAi<T>(s: RunSpec<T>): Promise<AiOutcome<T>> {
  const started = Date.now();
  const now = s.deps?.now ?? new Date();
  const cfg = await readAiConfig();
  const provider = s.deps?.provider !== undefined ? s.deps.provider : aiProvider();
  const finish = async (status: "OK" | "FALLBACK" | "ERROR" | "LIMITED", providerName: string, result: T, source: "AI" | "RULES", note: string, notice: string) => {
    await audit({ actor: s.actor, feature: s.feature, provider: providerName, status, inputChars: s.inputChars, outputChars: size(result), ms: Date.now() - started, subject: s.subject, note });
    return { result, source, notice };
  };
  const viaRules = async (status: "FALLBACK" | "ERROR" | "LIMITED", providerName: string, note: string, notice: string) => finish(status, providerName, await s.rules(), "RULES", note, notice);

  if (!s.assist) return viaRules("FALLBACK", "rules", "No assisted version of this feature", "");
  if (!provider) return viaRules("FALLBACK", "rules", "No AI service is connected", "Answered with the built-in rules. No AI service is connected.");
  if (!cfg.enabled) return viaRules("FALLBACK", provider.name, "Switched off by the administrator", "Answered with the built-in rules. The assistant is switched off.");

  const day = new Date(now.getTime() - 864e5), month = new Date(now.getTime() - 30 * 864e5);
  if (s.actor.userId) {
    if (cfg.perUserPerDay <= (await used(s.actor, day, "user"))) return viaRules("LIMITED", provider.name, "Daily limit for this person reached", "Answered with the built-in rules. You have used today's allowance for the assistant.");
    if (s.actor.companyId && cfg.perCompanyPerMonth <= (await used(s.actor, month, "company"))) return viaRules("LIMITED", provider.name, "Monthly limit for the company reached", "Answered with the built-in rules. Your company has used this month's allowance for the assistant.");
  } else if (cfg.publicPerDay <= (await used(s.actor, day, "visitor"))) {
    return viaRules("LIMITED", provider.name, "Daily limit for this visitor reached", "Answered with the built-in rules. You have used today's allowance for the assistant.");
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const out = await s.assist(provider, ctl.signal);
    if (out === null || out === undefined) return viaRules("ERROR", provider.name, "The AI answer was not usable", "Answered with the built-in rules. The assistant could not give a usable answer.");
    return finish("OK", provider.name, out, "AI", "", "");
  } catch (e) {
    return viaRules("ERROR", provider.name, e instanceof Error ? e.message.slice(0, 200) : "Failed", "Answered with the built-in rules. The assistant was not available.");
  } finally {
    clearTimeout(timer);
  }
}

/** Check that this person may use the assistant. A refusal is itself recorded. */
export async function requireAi(ctx: Ctx, feature: AiFeature, subject?: { type: string; id: string }) {
  try {
    assertCan(ctx, "ai.use");
  } catch (e) {
    await audit({ actor: { userId: ctx.userId, companyId: ctx.companyId }, feature, provider: "none", status: "DENIED", inputChars: 0, outputChars: 0, ms: 0, subject, note: `Role ${ctx.role} may not use the assistant` });
    throw e;
  }
}

/** Run a feature on behalf of a company member. Permission is checked first. */
export async function runAiFor<T>(ctx: Ctx, s: Omit<RunSpec<T>, "actor">) {
  await requireAi(ctx, s.feature, s.subject);
  return runAi<T>({ ...s, actor: { userId: ctx.userId, companyId: ctx.companyId } });
}

// ---------- Reading the record ----------

export async function aiStatus(adminId: string) {
  await assertAdmin(adminId);
  const since = new Date(Date.now() - 30 * 864e5);
  const [cfg, rows] = await Promise.all([readAiConfig(), system((tx) => tx.aiRun.groupBy({ by: ["feature", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }))]);
  return { connected: Boolean(aiProvider()), provider: aiProvider()?.name ?? null, config: cfg, usage: rows.map((r) => ({ feature: r.feature, label: AI_FEATURES[r.feature as AiFeature] ?? r.feature, status: r.status, count: r._count._all })) };
}

const PAGE = 25;
export async function aiAuditForAdmin(adminId: string, page = 0) {
  await assertAdmin(adminId);
  const [rows, total] = await Promise.all([system((tx) => tx.aiRun.findMany({ orderBy: { createdAt: "desc" }, skip: page * PAGE, take: PAGE })), system((tx) => tx.aiRun.count())]);
  return { rows, total, pageSize: PAGE };
}

export async function aiAuditForCompany(ctx: Ctx, page = 0) {
  assertCan(ctx, "ai.audit");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [rows, total] = await Promise.all([tx.aiRun.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, skip: page * PAGE, take: PAGE }), tx.aiRun.count({ where: { companyId: ctx.companyId } })]);
    return { rows, total, pageSize: PAGE };
  });
}
