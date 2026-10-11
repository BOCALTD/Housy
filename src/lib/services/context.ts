import { can, type Action, type Role } from "../permissions";

/** Who is acting, in which company. Built from the session by requireMember(), or directly in tests. */
export type Ctx = {
  userId: string;
  companyId: string;
  membershipId: string;
  role: Role;
};

export function assertCan(ctx: Ctx, action: Action) {
  if (!can(ctx.role, action)) {
    throw new Error("You do not have permission to do that. Ask your company administrator.");
  }
}
