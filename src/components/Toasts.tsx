"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Toaster, toast } from "sonner";
import { undoAction } from "@/app/undo-actions";
import { UNDO_SHOWN_MS } from "@/lib/undo-shown";

/** The toast area, top centre, following the light or dark setting. */
export function AppToaster() {
  return <Toaster position="top-center" richColors closeButton theme="system" toastOptions={{ duration: 6000, className: "app-toast" }} />;
}

/**
 * Every server action reports back by adding ?error=, ?notice= (success) or ?warning= to the page it returns to. This shows that
 * message as a toast on whichever page it lands on, then takes it out of the address so a refresh or a shared link does not
 * show it again.
 */
export function UrlToasts() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const shown = useRef("");
  useEffect(() => {
    const error = params.get("error"), notice = params.get("notice"), warning = params.get("warning"), undo = params.get("undo");
    if (!error && !notice && !warning) return;
    const key = `${path}|${error}|${notice}|${warning}`;
    if (shown.current === key) return;
    shown.current = key;
    if (error) toast.error(error);
    if (warning) toast.warning(warning);
    if (notice && undo) showUndo(notice, () => undoAction(undo), () => router.refresh());
    else if (notice) toast.success(notice);
    const rest = new URLSearchParams(params.toString());
    rest.delete("error"); rest.delete("notice"); rest.delete("warning"); rest.delete("undo");
    const q = rest.toString();
    router.replace(`${path}${q ? `?${q}` : ""}${window.location.hash}`, { scroll: false });
  }, [params, path, router]);
  return null;
}

/**
 * A success message with an Undo button for a few seconds. `run` reverses the action (on the server); `after` refreshes what the
 * page shows. Used after form actions (?undo=) and by buttons that act in place (likes, shares, saves).
 */
export function showUndo(message: string, run: () => Promise<{ ok: true; message: string } | { ok: false; error: string } | void>, after?: () => void) {
  toast.success(message, {
    duration: UNDO_SHOWN_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        const r = await run().catch(() => ({ ok: false as const, error: "That could not be undone. Try again." }));
        if (r && "ok" in r && !r.ok) { toast.error(r.error); return; }
        toast.success(r && "message" in r ? r.message : "Undone.");
        after?.();
      },
    },
  });
}
