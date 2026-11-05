"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { markRead } from "@/lib/services/notifications";

/** The bell's "Mark all as read". */
export async function markAllNoticesReadAction(_form: FormData): Promise<void> {
  const user = await requireUser();
  await markRead(user.id, null);
  revalidatePath("/", "layout");
}
