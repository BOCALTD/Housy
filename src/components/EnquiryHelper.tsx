"use client";

import { useState } from "react";

type Purpose = "SALE" | "RENT" | "LEASE";
const QUESTIONS: { id: string; label: string; text: string; for?: Purpose[] }[] = [
  { id: "avail", label: "Is it still available?", text: "Is it still available?" },
  { id: "view", label: "Arrange an inspection", text: "I would like to inspect it. Which days and times work?" },
  { id: "fees", label: "Every fee, in full", text: "Please send a full breakdown of what I would pay before moving in: rent, caution deposit, agency, legal and service charge.", for: ["RENT", "LEASE"] },
  { id: "title", label: "Title document", text: "Which title document does it have, and can my lawyer see it before any payment?", for: ["SALE"] },
  { id: "plan", label: "Payment plan", text: "Is there a payment plan, and what does it cost in total?", for: ["SALE"] },
  { id: "nego", label: "Is the price negotiable?", text: "Is the price negotiable?" },
  { id: "power", label: "Power and water", text: "How reliable are power and water (generator, solar, borehole)?" },
  { id: "who", label: "Who owns it", text: "Are you the owner, or acting for the owner? Please tell me how." },
];

/**
 * "Help me write this" on a property's enquiry form (master prompt §37): the visitor ticks what they want to ask, and a clear
 * message is written into the form for them to read and change before sending. Nothing is ticked to start with and nothing is
 * sent until they press Send.
 */
export function EnquiryHelper({ refId, title, purpose, target = "enqMessage" }: { refId: string; title: string; purpose: Purpose; target?: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [moveIn, setMoveIn] = useState("");
  const qs = QUESTIONS.filter((q) => !q.for || q.for.includes(purpose));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function write() {
    const el = document.getElementById(target) as HTMLTextAreaElement | null;
    if (!el) return;
    const lines = [`Hello, I am interested in “${title}” (${refId}).`];
    if (moveIn) lines.push(purpose === "SALE" ? `I would like to buy by ${fmt(moveIn)}.` : `I would like to move in by ${fmt(moveIn)}.`);
    for (const q of qs) if (picked.includes(q.id)) lines.push(q.text);
    lines.push("Thank you.");
    el.value = lines.join("\n");
    el.focus();
  }

  return (
    <details className="inline enq-helper">
      <summary>Help me write this</summary>
      <div className="stack" style={{ gap: 10 }}>
        <fieldset className="enq-qs">
          <legend className="small">What do you want to ask?</legend>
          {qs.map((q) => (
            <label key={q.id} className="enq-q"><input type="checkbox" checked={picked.includes(q.id)} onChange={() => toggle(q.id)} /><span>{q.label}</span></label>
          ))}
        </fieldset>
        <label className="field"><span>{purpose === "SALE" ? "When do you want to buy? (optional)" : "When do you want to move in? (optional)"}</span><input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} /></label>
        <button type="button" className="btn" onClick={write} disabled={picked.length === 0 && !moveIn}>Write my message</button>
        <p className="small muted">You can change the message before sending. Never pay anyone before you have inspected the property and seen its documents.</p>
      </div>
    </details>
  );
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
