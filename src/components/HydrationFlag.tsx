"use client";

import { useEffect } from "react";

/** Marks the page as running (React has started). public/health.js warns the visitor when this never happens. */
export function HydrationFlag() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
    document.getElementById("js-health")?.remove();
  }, []);
  return null;
}
