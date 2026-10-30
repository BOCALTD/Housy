/**
 * Offline field records (master prompt §49): an inspector downloads their inspections, records them without a connection, and
 * sends them when back online. The office may have changed the same inspection in the meantime, so each change is merged
 * field by field against the copy the device downloaded (a three-way merge):
 *
 * - changed only on the device: the device's value is applied;
 * - changed only in the office: the office's value stays;
 * - changed in both to different values: the office's value stays and the inspector is shown both to decide.
 *
 * Nothing is ever overwritten silently. Pure functions, tested on their own.
 */

export type FieldResponse = { result: string; note: string };
export type FieldRecord = {
  conductedOn: string; conditionRating: string; summary: string; recommendedActions: string;
  location: string; participants: string; technicalNotes: string;
  responses: Record<string, FieldResponse>;
};

export const RECORD_FIELDS = {
  conductedOn: "Date inspected", conditionRating: "Overall condition", summary: "Summary", recommendedActions: "Recommended actions",
  location: "Where on site", participants: "Who was present", technicalNotes: "Technical notes",
} as const;
export type RecordField = keyof typeof RECORD_FIELDS;

export type Conflict = { key: string; label: string; office: string; mine: string };

const sameResponse = (a: FieldResponse | undefined, b: FieldResponse | undefined) => (a?.result ?? "PENDING") === (b?.result ?? "PENDING") && (a?.note ?? "").trim() === (b?.note ?? "").trim();
const showResponse = (r: FieldResponse | undefined) => `${RESULT_WORDS[r?.result ?? "PENDING"] ?? r?.result}${r?.note?.trim() ? `: ${r.note.trim()}` : ""}`;
export const RESULT_WORDS: Record<string, string> = { PENDING: "Not checked", PASS: "Pass", ATTENTION: "Needs attention", FAIL: "Fail", NOT_APPLICABLE: "Not applicable" };

/**
 * Merge the device's record into the office's. `labels` names the checklist items for the conflict list. Response ids the
 * office no longer has are ignored (and reported by the caller as an error before this point).
 */
export function mergeRecord(base: FieldRecord, mine: FieldRecord, office: FieldRecord, labels: Record<string, string> = {}) {
  const merged: FieldRecord = { ...office, responses: { ...office.responses } };
  const conflicts: Conflict[] = [];
  let applied = 0;
  for (const k of Object.keys(RECORD_FIELDS) as RecordField[]) {
    const b = (base[k] ?? "").trim(), m = (mine[k] ?? "").trim(), o = (office[k] ?? "").trim();
    if (m === b || m === o) continue; // the device did not change it, or both agree
    if (o === b) { merged[k] = m; applied += 1; continue; }
    conflicts.push({ key: k, label: RECORD_FIELDS[k], office: o, mine: m });
  }
  for (const [id, m] of Object.entries(mine.responses)) {
    if (!(id in office.responses)) continue;
    const b = base.responses[id], o = office.responses[id];
    if (sameResponse(m, b) || sameResponse(m, o)) continue;
    if (sameResponse(o, b)) { merged.responses[id] = { result: m.result, note: m.note.trim() }; applied += 1; continue; }
    conflicts.push({ key: `item:${id}`, label: labels[id] ?? "Checklist item", office: showResponse(o), mine: showResponse(m) });
  }
  return { merged, conflicts, applied };
}

/** After the inspector decides: their value for each key they chose, the office's for the rest. The base becomes the office copy. */
export function resolveConflicts(office: FieldRecord, mine: FieldRecord, useMine: string[]): FieldRecord {
  const out: FieldRecord = { ...office, responses: { ...office.responses } };
  for (const key of useMine) {
    if (key.startsWith("item:")) { const id = key.slice(5); if (mine.responses[id] && id in out.responses) out.responses[id] = mine.responses[id]; }
    else if (key in RECORD_FIELDS) out[key as RecordField] = mine[key as RecordField];
  }
  return out;
}

/** How far through the checklist a record is, for the list on the device. */
export function progress(r: FieldRecord) {
  const all = Object.values(r.responses);
  return { done: all.filter((x) => x.result !== "PENDING").length, total: all.length, failed: all.filter((x) => x.result === "FAIL").length };
}

/** A client id the device makes for each thing it sends, so a resend is recognised. */
export const CLIENT_ID = /^[A-Za-z0-9-]{8,80}$/;
