// Role-based permissions for company members (master prompt Section 4).
// Every server action checks a permission before touching data; hiding buttons is only a convenience.

export type Role = "COMPANY_SUPER_ADMIN" | "MANAGER" | "AGENT" | "OFFICER" | "VIEWER";

export type Action =
  | "asset.view"
  | "asset.create"
  | "asset.update"
  | "party.manage"
  | "document.upload"
  | "document.download"
  | "lease.manage"
  | "payment.record"
  | "task.create"
  | "task.update.any"
  | "listing.manage"
  | "enquiry.view"
  | "team.manage";

const MATRIX: Record<Action, Role[]> = {
  "asset.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT", "OFFICER", "VIEWER"],
  "asset.create": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "asset.update": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "party.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "document.upload": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "document.download": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT", "OFFICER"],
  "lease.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "payment.record": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "task.create": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT", "OFFICER"],
  "task.update.any": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "listing.manage": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"],
  "enquiry.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"],
  "team.manage": ["COMPANY_SUPER_ADMIN"],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  COMPANY_SUPER_ADMIN: "Company Super Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
  OFFICER: "Officer",
  VIEWER: "Viewer",
};

export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];
