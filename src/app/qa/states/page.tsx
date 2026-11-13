import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QaStates } from "./QaStates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Interface states", robots: { index: false, follow: false } };

/**
 * Every kind of message and window the app shows, in one place, so the device check can open each on every screen size
 * and measure it. Only when QA_STATES=1 (the CI check sets it); everywhere else this page does not exist.
 */
export default function Page() {
  if (process.env.QA_STATES !== "1") notFound();
  return (
    <div className="wrap stack">
      <h1>Interface states</h1>
      <QaStates />
    </div>
  );
}
