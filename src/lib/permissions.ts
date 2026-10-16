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
  | "renewal.approve"
  | "lease.close"
  | "handover.record"
  | "maintenance.request"
  | "maintenance.manage"
  | "maintenance.approve"
  | "maintenance.work"
  | "maintenance.verify"
  | "inventory.manage"
  | "inventory.move"
  | "inventory.count"
  | "inventory.approve"
  | "valuation.view"
  | "valuation.manage"
  | "valuation.prepare"
  | "valuation.approve"
  | "project.view"
  | "project.manage"
  | "project.plan"
  | "project.cost"
  | "project.approve"
  | "inspection.manage"
  | "inspection.conduct"
  | "inspection.approve"
  | "obligation.manage"
  | "obligation.complete"
  | "service.manage"
  | "service.collect"
  | "service.expense"
  | "service.approve"
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
  | "file.manage"
  | "crm.view"
  | "crm.manage"
  | "crm.assign"
  | "crm.merge"
  | "crm.configure"
  | "crm.approve"
  | "crm.report"
  | "collab.view"
  | "collab.company"
  | "billing.view"
  | "billing.manage";

const MATRIX: Record<Action, Role[]> = {
  // Plans, invoices and advertising budgets: only the company administrator commits the company to spending money.
  "billing.view": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "billing.manage": ["COMPANY_SUPER_ADMIN"],
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
  "renewal.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "lease.close": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "handover.record": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "maintenance.request": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "maintenance.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "maintenance.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "maintenance.work": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "maintenance.verify": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "inventory.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "inventory.move": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "inventory.count": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "inventory.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  // Valuation (master prompt Phase 7). A report is prepared by one person and approved by another.
  "valuation.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER", "VIEWER"],
  "valuation.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "valuation.prepare": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "valuation.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  // Projects (master prompt Phase 7). Budgets, commitments, invoices and variations are decided by someone other than the person who raised them.
  "project.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER", "VIEWER"],
  "project.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "project.plan": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "project.cost": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "project.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "inspection.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "inspection.conduct": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "inspection.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "obligation.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "obligation.complete": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "service.manage": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "service.collect": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "service.expense": ["COMPANY_SUPER_ADMIN", "MANAGER", "OFFICER"],
  "service.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
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
  // CRM (master prompt Phase 8). Agents see their own clients, leads and deals (and a team lead sees the team's); managers see all.
  "crm.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"],
  "crm.manage": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"],
  "crm.assign": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "crm.merge": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "crm.configure": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "crm.approve": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  "crm.report": ["COMPANY_SUPER_ADMIN", "MANAGER"],
  // Collaboration: agents and managers take part; managers and administrators speak for the company (invite, accept, suspend, add people).
  "collab.view": ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"],
  "collab.company": ["COMPANY_SUPER_ADMIN", "MANAGER"],
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
