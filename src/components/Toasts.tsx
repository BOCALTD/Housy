"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Toaster, toast } from "sonner";

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
    const error = params.get("error"), notice = params.get("notice"), warning = params.get("warning");
    if (!error && !notice && !warning) return;
    const key = `${path}|${error}|${notice}|${warning}`;
    if (shown.current === key) return;
    shown.current = key;
    if (error) toast.error(error);
    if (warning) toast.warning(warning);
    if (notice) toast.success(notice);
    const rest = new URLSearchParams(params.toString());
    rest.delete("error"); rest.delete("notice"); rest.delete("warning");
    const q = rest.toString();
    router.replace(`${path}${q ? `?${q}` : ""}${window.location.hash}`, { scroll: false });
  }, [params, path, router]);
  return null;
}
