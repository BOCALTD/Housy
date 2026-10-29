import Link from "next/link";
import { allPlans } from "@/lib/services/billing";
import { PlanCompare } from "@/components/PlanCompare";
import { getSession } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/labels";

export const metadata = { title: "Plans and pricing", description: `Every ${PLATFORM_NAME} plan side by side, for companies, agents and people looking for property.` };
export const dynamic = "force-dynamic";

/** Every plan for every audience, side by side; what a plan does not include is struck through. */
export default async function PricingPage() {
  const [plans, session] = await Promise.all([allPlans(["COMPANY", "SEEKER", "AGENT"]), getSession()]);
  const group = (a: "COMPANY" | "SEEKER" | "AGENT") => plans.filter((p) => p.audience === a);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6, maxWidth: 760 }}>
        <p className="eyebrow">Plans and pricing</p>
        <h1>Choose the plan that fits</h1>
        <p className="muted">Every plan shows the same list, so you can see at a glance what each one adds. Anything a plan does not include is struck through; the most complete plan includes everything. Prices are in naira.</p>
        {session ? <p className="small"><Link href={session.companyId ? "/app/billing" : "/me/billing"}>Go to your plan and billing</Link></p> : null}
      </div>
      <section className="stack" aria-labelledby="p-co"><h2 id="p-co">For property companies</h2><PlanCompare audience="COMPANY" plans={group("COMPANY")} /></section>
      <section className="stack" aria-labelledby="p-ag"><h2 id="p-ag">For agents</h2><PlanCompare audience="AGENT" plans={group("AGENT")} /></section>
      <section className="stack" aria-labelledby="p-se"><h2 id="p-se">For people looking for property</h2><PlanCompare audience="SEEKER" plans={group("SEEKER")} /></section>
      <p className="small muted">Plans switch features on; they never give anyone access to another person's or company's records. Questions about a plan? <Link href="/support">Talk to us</Link>.</p>
    </div>
  );
}
