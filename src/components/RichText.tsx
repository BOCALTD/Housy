import Link from "next/link";
import { Fragment } from "react";
import { parseBody, type Block, type Inline } from "@/lib/blog-rules";

/** A blog post's text as React elements: nothing in a post can add markup or scripts (see lib/blog-rules.ts). */
function Parts({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => {
    if (p.t === "b") return <strong key={i}>{p.v}</strong>;
    if (p.t === "i") return <em key={i}>{p.v}</em>;
    if (p.t === "code") return <code key={i}>{p.v}</code>;
    if (p.t === "a") return p.external ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.v}</a> : <Link key={i} href={p.href}>{p.v}</Link>;
    return <Fragment key={i}>{p.v}</Fragment>;
  })}</>;
}

export function RichBlocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b, i) => {
    switch (b.t) {
      case "h2": return <h2 key={i} id={b.id}>{b.text}</h2>;
      case "h3": return <h3 key={i} id={b.id}>{b.text}</h3>;
      case "ul": return <ul key={i}>{b.items.map((it, j) => <li key={j}><Parts parts={it} /></li>)}</ul>;
      case "ol": return <ol key={i}>{b.items.map((it, j) => <li key={j}><Parts parts={it} /></li>)}</ol>;
      case "quote": return <blockquote key={i}><Parts parts={b.parts} /></blockquote>;
      default: return <p key={i}><Parts parts={b.parts} /></p>;
    }
  })}</>;
}

export function RichText({ body }: { body: string }) {
  return <RichBlocks blocks={parseBody(body)} />;
}
