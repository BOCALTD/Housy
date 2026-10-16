import Link from "next/link";
import { redirect } from "next/navigation";
import { publishedMonths } from "@/lib/services/awards";
import { monthLabel } from "@/lib/award-rules";
import { ShowMore } from "@/components/ui";

export const metadata = { title: "Top Agent of the Month" };
export const dynamic = "force-dynamic";

export default async function AwardsPage() {
  const months = await publishedMonths();
  if (months.length) redirect(`/awards/${months[0].month}`);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Top Agent of the Month</h1><p className="muted">No month has been ranked yet. Rankings are published once a month is over.</p></div>
      <ShowMore items={months.map((m) => <li key={m.id}><Link href={`/awards/${m.month}`}>{monthLabel(m.month)}</Link></li>)} />
    </div>
  );
}
