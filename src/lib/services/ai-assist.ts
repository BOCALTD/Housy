import { withTenant } from "../db";
import { logActivity } from "../audit";
import { SAFETY_RULES, REPORTS, asData, chooseReport, cleanChoice, classifyDocument, isHighImpact, summarise, type ReportChoice, type Summary } from "../ai-rules";
import { jsonFrom } from "../ai-provider";
import { formatKobo } from "../money";
import { assertCan, type Ctx } from "./context";
import { requireAi, runAiFor, type Deps } from "./ai";
import { companyAnalytics } from "./analytics";
import { getCorrespondence } from "./correspondence";

/**
 * Assisted work inside a company: sorting documents, summarising letters, answering questions about the portfolio.
 * The assistant only ever receives text the person could already read on screen, and everything it proposes is held as a
 * suggestion until someone allowed to review it accepts it.
 */

const DOC_CATEGORIES = ["TITLE_OWNERSHIP", "LEASE_AGREEMENT", "MANAGEMENT_AGREEMENT", "SURVEY_PLAN", "VALUATION_REPORT", "INSPECTION_REPORT", "INSURANCE", "TAX_RECEIPT", "PERMIT_APPROVAL", "CORRESPONDENCE", "OTHER"] as const;
type DocCat = (typeof DOC_CATEGORIES)[number];

// ---------- Documents ----------

export async function suggestDocumentCategory(ctx: Ctx, documentId: string, deps?: Deps) {
  await requireAi(ctx, "CLASSIFY", { type: "document", id: documentId });
  assertCan(ctx, "document.download");
  const doc = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.assetDocument.findFirst({ where: { id: documentId, companyId: ctx.companyId }, select: { id: true, title: true, fileName: true, category: true } }));
  if (!doc) throw new Error("Document not found");
  const rules = classifyDocument(doc.title, doc.fileName);
  const out = await runAiFor(ctx, {
    feature: "CLASSIFY", subject: { type: "document", id: doc.id }, inputChars: doc.title.length + doc.fileName.length, deps,
    rules: () => rules,
    assist: async (provider, signal) => {
      const r = await provider.complete({ system: `${SAFETY_RULES}\nChoose the category of a property document from its title and file name only. Reply with JSON: {"category": one of ${DOC_CATEGORIES.join(", ")}, "confidence": 0-100, "why": one short sentence}.`, user: asData("document", `Title: ${doc.title}\nFile name: ${doc.fileName}`, 500), maxTokens: 150, signal });
      if (!r.ok) throw new Error(r.error);
      const j = jsonFrom(r.text) as { category?: unknown; confidence?: unknown; why?: unknown } | null;
      if (!j || typeof j.category !== "string" || !(DOC_CATEGORIES as readonly string[]).includes(j.category)) return null;
      const conf = Number(j.confidence);
      return { category: j.category as DocCat, confidence: Number.isFinite(conf) ? Math.max(0, Math.min(90, Math.round(conf))) : 50, why: typeof j.why === "string" ? j.why.slice(0, 200) : "Suggested by the assistant" };
    },
  });
  const s = out.result;
  if (s.category === doc.category || s.category === "OTHER") return { suggestion: null, source: out.source, notice: out.notice, reason: s.category === doc.category ? "It is already in that category" : s.why };
  const made = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const pending = await tx.aiSuggestion.findFirst({ where: { companyId: ctx.companyId, kind: "DOCUMENT_CATEGORY", subjectId: doc.id, status: "PENDING" } });
    if (pending) await tx.aiSuggestion.delete({ where: { id: pending.id } });
    return tx.aiSuggestion.create({ data: { companyId: ctx.companyId, kind: "DOCUMENT_CATEGORY", subjectType: "document", subjectId: doc.id, payload: { from: doc.category, to: s.category, why: s.why, title: doc.title }, source: out.source, confidence: s.confidence, createdById: ctx.userId } });
  });
  return { suggestion: made, source: out.source, notice: out.notice, reason: "" };
}

/** Suggest categories for documents currently filed as "Other", a few at a time. */
export async function suggestForUnsorted(ctx: Ctx, deps?: Deps) {
  await requireAi(ctx, "CLASSIFY");
  const docs = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.assetDocument.findMany({ where: { companyId: ctx.companyId, category: "OTHER" }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 20 }));
  let made = 0;
  for (const d of docs) { const r = await suggestDocumentCategory(ctx, d.id, deps); if (r.suggestion) made += 1; }
  return { looked: docs.length, made };
}

// ---------- Correspondence ----------

export interface SummaryPayload extends Summary { highImpact: boolean; subject: string; reference: string }

function textOf(rec: { subject: string; description: string; requiredAction: string; draftResponse: string }, actions: { note: string }[]) {
  return [rec.subject, rec.description, rec.requiredAction && `Action needed: ${rec.requiredAction}`, ...actions.map((a) => a.note).filter(Boolean)].filter(Boolean).join("\n").slice(0, 6000);
}

export async function summariseCorrespondence(ctx: Ctx, correspondenceId: string, deps?: Deps) {
  await requireAi(ctx, "SUMMARY", { type: "correspondence", id: correspondenceId });
  const got = await getCorrespondence(ctx, correspondenceId); // applies the confidentiality rules for this person
  if (!got) throw new Error("Correspondence not found");
  const { rec } = got;
  const text = textOf(rec, rec.actions);
  const rules = summarise(text);
  const high = isHighImpact(text) || /legal|notice|dispute/i.test(rec.category);
  const out = await runAiFor(ctx, {
    feature: "SUMMARY", subject: { type: "correspondence", id: rec.id }, inputChars: text.length, deps,
    rules: () => rules,
    // Confidential letters are never sent to an outside service. They are summarised by the built-in rules only.
    assist: rec.confidential ? undefined : async (provider, signal) => {
      const r = await provider.complete({ system: `${SAFETY_RULES}\nSummarise the correspondence in at most 4 sentences, using only what it says. List what is being asked, and any dates or amounts exactly as written. Reply with JSON: {"summary": string, "keyPoints": string[], "asks": string[], "dates": string[], "amounts": string[]}.`, user: asData("correspondence", text), maxTokens: 600, signal });
      if (!r.ok) throw new Error(r.error);
      const j = jsonFrom(r.text) as Record<string, unknown> | null;
      if (!j || typeof j.summary !== "string" || !j.summary.trim()) return null;
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 6) : []);
      // Only dates and amounts that really appear in the letter are kept, so the assistant cannot invent a deadline.
      const real = (xs: string[]) => xs.filter((x) => text.includes(x));
      return { summary: j.summary.slice(0, 900), keyPoints: list(j.keyPoints), asks: list(j.asks), dates: real(list(j.dates)), amounts: real(list(j.amounts)) } satisfies Summary;
    },
  });
  const payload: SummaryPayload = { ...out.result, highImpact: high, subject: rec.subject, reference: rec.ref };
  const made = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.aiSuggestion.deleteMany({ where: { companyId: ctx.companyId, kind: "CORRESPONDENCE_SUMMARY", subjectId: rec.id, status: "PENDING" } });
    return tx.aiSuggestion.create({ data: { companyId: ctx.companyId, kind: "CORRESPONDENCE_SUMMARY", subjectType: "correspondence", subjectId: rec.id, payload: payload as never, source: out.source, confidence: 0, createdById: ctx.userId } });
  });
  return { suggestion: made, payload, source: out.source, notice: out.notice };
}

// ---------- Review ----------

export async function pendingSuggestions(ctx: Ctx, kind?: "DOCUMENT_CATEGORY" | "CORRESPONDENCE_SUMMARY") {
  assertCan(ctx, "ai.use");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.aiSuggestion.findMany({ where: { companyId: ctx.companyId, status: "PENDING", ...(kind ? { kind } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }));
}

export async function suggestionsFor(ctx: Ctx, subjectType: string, subjectId: string) {
  assertCan(ctx, "ai.use");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.aiSuggestion.findMany({ where: { companyId: ctx.companyId, subjectType, subjectId }, orderBy: { createdAt: "desc" }, take: 10 }));
}

/**
 * Accepting a document category changes the document's category. Accepting a summary only marks it as checked by a person.
 * Summaries of legal or financial matters need a note saying what the reviewer checked. The person who asked for a suggestion
 * may not be the one to accept it when it is high-impact.
 */
export async function decideSuggestion(ctx: Ctx, id: string, decision: "accept" | "reject", note = "") {
  assertCan(ctx, "ai.review");
  const n = note.trim().slice(0, 500);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await tx.aiSuggestion.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!s) throw new Error("Suggestion not found");
    if (s.status !== "PENDING") throw new Error("That suggestion has already been decided");
    const payload = s.payload as { to?: DocCat; highImpact?: boolean };
    if (decision === "accept") {
      if (payload.highImpact) {
        if (n.length < 5) throw new Error("This concerns a legal or financial matter. Say what you checked before accepting the summary");
        if (s.createdById === ctx.userId) throw new Error("This concerns a legal or financial matter, so someone other than the person who asked for the summary must review it");
      }
      if (s.kind === "DOCUMENT_CATEGORY") {
        if (!payload.to || !(DOC_CATEGORIES as readonly string[]).includes(payload.to)) throw new Error("The suggestion is not usable");
        const doc = await tx.assetDocument.findFirst({ where: { id: s.subjectId, companyId: ctx.companyId } });
        if (!doc) throw new Error("The document no longer exists");
        await tx.assetDocument.update({ where: { id: doc.id }, data: { category: payload.to } });
      }
    }
    const done = await tx.aiSuggestion.update({ where: { id: s.id }, data: { status: decision === "accept" ? "ACCEPTED" : "REJECTED", reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: n } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "ai_suggestion", entityId: s.id, action: `ai.suggestion_${decision === "accept" ? "accepted" : "rejected"}`, detail: { kind: s.kind, subject: s.subjectId, source: s.source } });
    return done;
  });
}

// ---------- Questions about the portfolio ----------

export interface Answer { report: keyof typeof REPORTS | null; title: string; summary: string; columns: string[]; rows: string[][]; allowed: boolean; limits: string; source: "AI" | "RULES"; notice: string }

const LIMITS = "Counted from your company's records when you asked. Check anything you will act on against the source records. Values come only from approved valuation reports.";

export async function askPortfolio(ctx: Ctx, question: string, deps?: Deps): Promise<Answer> {
  await requireAi(ctx, "REPORT");
  const q = question.trim().slice(0, 300);
  if (q.length < 4) throw new Error("Ask a question, for example: How much rent is overdue?");
  const rules = chooseReport(q);
  const out = await runAiFor<ReportChoice | null>(ctx, {
    feature: "REPORT", inputChars: q.length, deps,
    rules: () => rules,
    assist: async (provider, signal) => {
      const r = await provider.complete({ system: `${SAFETY_RULES}\nChoose which report answers the question. Reply with JSON: {"report": one of ${Object.keys(REPORTS).join(", ")}, "city": string or null, "days": 30, 60 or 90}.`, user: asData("question", q, 400), maxTokens: 100, signal });
      if (!r.ok) throw new Error(r.error);
      return cleanChoice(jsonFrom(r.text)) ?? rules;
    },
  });
  const choice = out.result;
  const base = { source: out.source, notice: out.notice, limits: LIMITS };
  if (!choice) return { ...base, report: null, title: "I could not match that to a report", summary: `Try asking about: ${Object.values(REPORTS).map((r) => r.label.toLowerCase()).join(", ")}.`, columns: [], rows: [], allowed: true };
  const a = await companyAnalytics(ctx);
  const title = REPORTS[choice.report].label;
  const deny = { ...base, report: choice.report, title, summary: "Your role does not include this information. Ask your company administrator.", columns: [], rows: [], allowed: false };
  if (!a) return deny;
  const k = (x: bigint) => formatKobo(x);
  switch (choice.report) {
    case "OCCUPANCY": {
      const o = a.occupancy; if (!o) return deny;
      const rows = o.byCity.filter((c) => !choice.city || c.city.toLowerCase() === choice.city.toLowerCase()).map((c) => [c.city, String(c.occupied), String(c.vacant)]);
      return { ...base, report: "OCCUPANCY", title, allowed: true, summary: o.ratePct === null ? "No properties are marked occupied or vacant yet." : `${o.occupied} of ${o.leasable} properties are occupied (${o.ratePct}%). ${o.vacant} are vacant.${choice.city && rows.length === 0 ? ` None of your properties in ${choice.city} are marked occupied or vacant.` : ""}`, columns: ["City", "Occupied", "Vacant"], rows };
    }
    case "ARREARS": {
      const x = a.arrears; if (!x) return deny;
      return { ...base, report: "ARREARS", title, allowed: true, summary: x.charges === 0 ? "No rent is overdue." : `${k(x.totalKobo)} is overdue across ${x.charges} charges.`, columns: ["Age", "Charges", "Amount"], rows: [...x.buckets.map((b) => [b.label, String(b.charges), k(b.kobo)]), ...x.top.map((t) => [`Highest: ${t.asset}`, "", k(t.kobo)])] };
    }
    case "LEASES_ENDING": {
      const o = a.occupancy; if (!o) return deny;
      const n = choice.days === 30 ? o.leasesEnding.in30 : choice.days === 60 ? o.leasesEnding.in60 : o.leasesEnding.in90;
      return { ...base, report: "LEASES_ENDING", title, allowed: true, summary: `${n} active ${n === 1 ? "lease ends" : "leases end"} within ${choice.days} days.`, columns: ["Within", "Leases"], rows: [["30 days", String(o.leasesEnding.in30)], ["60 days", String(o.leasesEnding.in60)], ["90 days", String(o.leasesEnding.in90)]] };
    }
    case "MAINTENANCE": {
      const m = a.maintenance; if (!m) return deny;
      return { ...base, report: "MAINTENANCE", title, allowed: true, summary: `${m.open} work orders are open, ${m.overdue} past their target date and ${m.urgent} high priority. ${m.completed90} were completed in the last 90 days${m.avgDaysToComplete !== null ? `, taking ${m.avgDaysToComplete} days on average` : ""}, costing ${k(m.cost90Kobo)}.`, columns: ["Status", "Open"], rows: m.byStatus.map((s) => [s.status.replace(/_/g, " ").toLowerCase(), String(s.n)]) };
    }
    case "VALUES": {
      const v = a.values; if (!v) return deny;
      return { ...base, report: "VALUES", title, allowed: true, summary: `Recorded cost of your properties is ${k(v.costKobo)}. ${v.valuedAssets} have an approved valuation, totalling ${k(v.valuedKobo)}; ${v.assetsWithoutValuation} have none.${v.assetsWithoutCost ? ` ${v.assetsWithoutCost} have no cost recorded.` : ""}`, columns: ["Measure", "Amount"], rows: [["Recorded cost", k(v.costKobo)], ["Approved valuations", k(v.valuedKobo)], ["Properties valued", String(v.valuedAssets)], ["Not valued", String(v.assetsWithoutValuation)]] };
    }
    case "PROJECTS": {
      const p = a.projects; if (!p) return deny;
      return { ...base, report: "PROJECTS", title, allowed: true, summary: p.active === 0 ? "No projects are active." : `${p.active} projects are active; ${p.rows.filter((r) => r.late).length} are past their planned end.`, columns: ["Project", "Progress", "Planned end"], rows: p.rows.map((r) => [`${r.ref} ${r.title}`, `${r.percent}%`, `${r.plannedEnd.toISOString().slice(0, 10)}${r.late ? " (late)" : ""}`]) };
    }
    case "COMPLIANCE": {
      const c = a.compliance; if (!c) return deny;
      return { ...base, report: "COMPLIANCE", title, allowed: true, summary: `${c.overdue} obligations are overdue; ${c.in30} fall due within 30 days, ${c.in90} within 90. ${c.documentsExpiring90} documents expire within 90 days.`, columns: ["Obligation", "Due"], rows: c.next.map((n) => [n.title, `${n.dueDate.toISOString().slice(0, 10)}${n.overdue ? " (overdue)" : ""}`]) };
    }
  }
}
