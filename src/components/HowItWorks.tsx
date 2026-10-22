"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./Icons";

const FLOWS = {
  seekers: {
    label: "Looking for property",
    steps: [
      { icon: Icon.search, title: "Search", text: "Search by city, price and bedrooms, browse the map, watch reels or describe what you want in a sentence." },
      { icon: Icon.shield, title: "Check who you deal with", text: "Every company and agent shows a trust level from identity and business checks done by our team." },
      { icon: Icon.chat, title: "Enquire and inspect", text: "Message the company, agree an inspection and ask your questions in one place. Never pay before inspecting." },
      { icon: Icon.key, title: "Verify, then close", text: "Ask an approved professional to check the documents before you pay. Your deal is recorded when it completes." },
    ],
    cta: { href: "/", label: "Start searching" },
  },
  companies: {
    label: "Companies and agents",
    steps: [
      { icon: Icon.building, title: "Register your company", text: "Create the company workspace and invite your team with the right roles." },
      { icon: Icon.shield, title: "Complete verification", text: "Submit CAC details, office address and a director's ID. Agents add their ID, photo and licence. Your trust level rises as checks pass." },
      { icon: Icon.home, title: "List and promote", text: "Add properties with photos, send them for review, and run offers that appear in the promotions slideshow." },
      { icon: Icon.chart, title: "Manage everything", text: "Leases, rent, receipts, maintenance, inspections, documents and deals in one workspace." },
    ],
    cta: { href: "/signup", label: "Register a company" },
  },
};

export function HowItWorks() {
  const [tab, setTab] = useState<keyof typeof FLOWS>("seekers");
  const f = FLOWS[tab];
  return (
    <div className="how">
      <div className="how-tabs" role="tablist" aria-label="How it works for">
        {(Object.keys(FLOWS) as (keyof typeof FLOWS)[]).map((k) => (
          <button key={k} type="button" role="tab" id={`how-${k}`} aria-selected={tab === k} aria-controls="how-panel" onClick={() => setTab(k)}>{FLOWS[k].label}</button>
        ))}
      </div>
      <div id="how-panel" role="tabpanel" aria-labelledby={`how-${tab}`} className="stack">
        <ol className="steps">
          {f.steps.map((s) => (
            <li key={s.title} className="step">
              <span className="step-ico">{s.icon()}</span>
              <strong>{s.title}</strong>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="row"><Link className="btn primary" href={f.cta.href}>{f.cta.label}</Link><Link className="sec-link" href="/how-it-works">More about how it works</Link></div>
      </div>
    </div>
  );
}
