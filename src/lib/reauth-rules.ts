// "Confirm it's you": which areas ask for the password again, and for how long a confirmation lasts (see services/reauth.ts).
import type { Action } from "./permissions";

export const REAUTH_MINUTES = 15;
export const REAUTH_MAX_FAILS = 5;

export const SENSITIVE_ADMIN_PATHS = [
  "/admin/settings", "/admin/connections", "/admin/payments", "/admin/finance", "/admin/people", "/admin/companies", "/admin/plans",
  "/admin/sign-in-locks", "/admin/kyc", "/admin/legal", "/admin/rewards", "/admin/referrals", "/admin/promotions",
];
export const SENSITIVE_ACTIONS: Action[] = ["settings.manage", "team.manage", "billing.manage", "api.manage", "kyc.manage", "payout.approve"];

export const isSensitivePath = (path: string) => SENSITIVE_ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
export const isSensitiveAction = (a?: Action) => !!a && SENSITIVE_ACTIONS.includes(a);

/** Whether this session confirmed recently enough. */
export const confirmedRecently = (s: { reauthAt: Date | null }, now = Date.now()) => !!s.reauthAt && now - s.reauthAt.getTime() < REAUTH_MINUTES * 60_000;

