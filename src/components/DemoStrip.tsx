import { unstable_cache } from "next/cache";
import Link from "next/link";
import { withPlatformAdmin } from "@/lib/db";

const hasDemo = unstable_cache(
  async () => (await withPlatformAdmin("system", (tx) => tx.user.count({ where: { email: "demo.alpha@example.test" } })).catch(() => 0)) > 0,
  ["demo-data-present"], { revalidate: 300 },
);

/** A thin strip on every page while the demonstration data is loaded: the companies, people and properties are samples. */
export async function DemoStrip() {
  if (!(await hasDemo())) return null;
  return (
    <div className="demo-strip" role="note">
      <span className="demo-strip-tag">DEMO</span>
      <span>Sample data: the companies, agents, properties, photos and videos on this site are examples to show how it works.</span>
      <Link href="/how-it-works">How it works</Link>
    </div>
  );
}
