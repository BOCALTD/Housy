/** "UNDER_RENOVATION" -> "Under renovation" */
export function humanize(value: string): string {
  const s = value.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME || "[Platform Name]";

/** Visual tone for status pills. */
export function tone(status: string): "ok" | "warn" | "bad" | "brand" | "" {
  switch (status) {
    case "PUBLISHED": case "OCCUPIED": case "ACTIVE": case "DONE": case "PAID": case "APPROVED": case "CLOSED": case "WAIVED": case "RECONCILED":
      return "ok";
    case "PENDING_REVIEW": case "UNDER_RENOVATION": case "IN_PROGRESS": case "PART_PAID": case "PENDING": case "HIGH": case "DUE":
      return "warn";
    case "OVERDUE": case "CRITICAL": case "SUSPENDED": case "DISPOSED": case "CANCELLED": case "WITHDRAWN": case "REVERSED": case "REJECTED":
      return "bad";
    case "VACANT": case "OPEN": case "SUBMITTED":
      return "brand";
    default:
      return "";
  }
}
