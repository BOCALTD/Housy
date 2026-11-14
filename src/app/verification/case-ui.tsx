import { requestTimeZone } from "@/lib/money-context";
import { CASE_STATUS_WORDS, OUTCOMES, type CaseStatus } from "@/lib/verification-case-rules";
import { SERVICE_CATEGORIES } from "@/lib/verification-network-rules";

const TONE: Partial<Record<CaseStatus, string>> = {
  DELIVERED: "ok", COMPLETED: "ok", APPROVED_FOR_RELEASE: "ok",
  REJECTED: "bad", CANCELLED: "bad", DISPUTED: "bad",
  INFORMATION_REQUIRED: "warn", CORRECTION_REQUIRED: "warn", ASSIGNED: "warn", PENDING_PAYMENT: "warn",
};

export function CaseStatusPill({ status }: { status: string }) {
  return <span className={`pill ${TONE[status as CaseStatus] ?? ""}`}>{CASE_STATUS_WORDS[status as CaseStatus] ?? status}</span>;
}

export const serviceName = (code: string) => SERVICE_CATEGORIES.find((s) => s.code === code)?.name ?? code;
export const outcomeName = (code: string) => OUTCOMES.find((o) => o[0] === code)?.[1] ?? (code || "Not chosen yet");
export const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: requestTimeZone() }) : "—");
export const when = (d: Date | null | undefined) => (d ? d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: requestTimeZone() }) : "—");
export const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const naira = (kobo: bigint | null) => (kobo === null ? "Quoted per case" : `₦${(Number(kobo) / 100).toLocaleString("en-NG")}`);

const ACTION_WORDS: Record<string, string> = {
  requested: "Request sent", billing_confirmed: "Confirmed by Housy", payment_requested: "Payment requested", quoted: "Quoted: invoice sent",
  payment_received: "Payment received", refunded: "Refunded", complaint_filed: "Complaint sent", billing_note: "How it is paid for", rejected: "Not taken on",
  offered: "Offered to a provider", offered_with_override: "Offered to a provider (override recorded)", offer_expired: "Offer not answered in time",
  offer_withdrawn: "Offer withdrawn", accepted: "Accepted by the provider", declined: "Declined by the provider", declined_conflict: "Declined: conflict of interest",
  staff_assigned: "Officer and reviewer chosen", document_review: "Reviewing documents", information_required: "More information needed",
  information_provided: "Customer answered", field_inspection: "Site inspection", investigation_in_progress: "Investigation in progress",
  report_draft: "Writing the report", inspection_scheduled: "Site visit booked", inspection_completed: "Site visit done", evidence_added: "Evidence added",
  document_added: "Document added", correcting: "Correcting the report", sent_for_internal_review: "Sent for the provider's review",
  correction_requested: "Sent back for correction", submitted_to_housy: "Submitted to Housy", platform_review_started: "Housy review started",
  approved_for_release: "Approved by Housy", platform_correction_requested: "Housy asked for corrections", report_released: "Report delivered",
  report_revoked: "Report revoked", completed: "Completed", disputed: "Disputed", dispute_reopened: "Dispute: reopened for review",
  dispute_closed: "Dispute closed", cancelled: "Cancelled",
};

type Act = { action: string; note: string; createdAt: Date; actor?: string; actorKind: string; visibleToCustomer?: boolean };

/** The case's history, newest last. Internal steps (not shown to the customer) are marked for staff. */
export function CaseTimeline({ items, staff = false }: { items: Act[]; staff?: boolean }) {
  const shown = staff ? items : items.filter((a) => a.visibleToCustomer !== false);
  if (!shown.length) return <p className="muted">Nothing yet.</p>;
  return (
    <ol className="vp-timeline">
      {shown.map((a, i) => (
        <li key={i} className={staff && a.visibleToCustomer === false ? "internal" : ""}>
          <strong>{ACTION_WORDS[a.action] ?? a.action.replace(/_/g, " ")}</strong>
          <span className="small muted"> · {when(a.createdAt)}{staff && a.actor ? ` · ${a.actor}` : ""}{staff && a.visibleToCustomer === false ? " · not shown to the customer" : ""}</span>
          {a.note ? <p className="small">{a.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}
