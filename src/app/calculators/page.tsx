import { Calculators } from "@/components/Calculators";
import { CALCULATORS, type CalcId } from "@/lib/calc-rules";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "Property calculators", description: "Rent affordability, move-in costs, purchase costs, rental yield, investment, development and loan calculators." };

/** Figures a listing can pass in (?tab=movein&yearlyRent=3000000), so a calculator opens already filled in. Only known numeric keys are taken. */
const KEYS = ["price", "yearlyRent", "serviceCharge", "amount", "floorArea", "area", "value"];

export default async function CalculatorsPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const tab = (CALCULATORS.find((c) => c.id === sp(s, "tab"))?.id ?? "afford") as CalcId;
  const preset: Record<string, number> = {};
  for (const k of KEYS) { const n = Number(sp(s, k)); if (Number.isFinite(n) && n > 0 && n < 1e13) preset[k] = Math.round(n); }
  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/cta.jpg" alt="" />
        <p className="eyebrow">Tools</p>
        <h1>Property calculators</h1>
        <p>Work out what renting, buying, investing or building would really cost. Every assumption is shown and you can change it.</p>
      </section>
      <Calculators start={tab} preset={preset} />
    </div>
  );
}
