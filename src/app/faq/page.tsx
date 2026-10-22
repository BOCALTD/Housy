import Link from "next/link";
import { FAQS, type Faq } from "@/lib/faq";

export const metadata = { title: "Questions and answers" };

const TOPICS: Faq["topic"][] = ["Buying and renting", "Verification and safety", "Companies and agents", "Payments and fees", "Your account"];

export default function FaqPage() {
  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/shortlet.jpg" alt="" />
        <p className="eyebrow">Help</p>
        <h1>Questions and answers</h1>
        <p>Short answers to what people ask most. Cannot find yours? <Link href="/support" style={{ color: "#FFD36B" }}>Contact support</Link>.</p>
      </section>
      {TOPICS.map((t) => (
        <section key={t} className="stack">
          <h2>{t}</h2>
          <div className="faq">{FAQS.filter((f) => f.topic === t).map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
        </section>
      ))}
    </div>
  );
}
