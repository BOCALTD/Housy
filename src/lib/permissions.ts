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
  | "payment.reverse"
  | "payment.reconcile"
  | "adjustment.request"
  | "adjustment.approve"
  | "deposit.manage"
  | "deposit.settle"
  | "finance.view"
  | "task.create"
  | "task.update.any"
  | "listing.manage"
  | "enquiry.view"
  | "team.manage"
  | "settings.manage"
  | "correspondence.view"
  | "correspondence.register"
  | "correspondence.assign"
  | "correspondence.approve"
  | "correspondence.confidential"
  | "file.manage";

const MATRIX: Record<Action, Role[]> = {
  "asset.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT", "OFFICER", "VIEWER"],
  "asset.create": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "asset.update": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "party.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "document.upload": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "document.download": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT", "OFFICER"],
  "lease.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "payment.record": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  // Rent ledger (master prompt Sections 12 and 13). Money received, adjusted or returned is recorded by
  // one person and confirmed or approved by another.
  "payment.reverse": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "payment.reconcile": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "adjustment.request": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "adjustment.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "deposit.manage": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "deposit.settle": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "finance.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER", "VIEWER"],
  "task.create": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT", "OFFICER"],
  "task.update.any": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "listing.manage": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"],
  "enquiry.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"],
  "team.manage": ["COMPANY_SUPER_ADMIN"],
  "settings.manage": ["COMPANY_SUPER_ADMIN"],
  // Correspondence (master prompt Section 11). Confidential records are visible only to
  // these roles and to the person assigned to them.
  "correspondence.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT", "OFFICER", "VIEWER"],
  "correspondence.register": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "correspondence.assign": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "correspondence.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "correspondence.confidential": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "file.manage": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
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
