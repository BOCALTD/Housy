import Link from "next/link";
import { latestReviews } from "@/lib/services/home";
import { formatDate } from "@/lib/dates";
import { ShowMore } from "@/components/ui";

export const metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const initials = (s: string) => s.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export default async function ReviewsPage() {
  const reviews = await latestReviews(60);
  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/city-2.jpg" alt="" />
        <p className="eyebrow">Reviews</p>
        <h1>What clients say about companies and agents</h1>
        <p>Only people with a recorded inspection, deal or conversation can leave a review, so every one comes from a real interaction. Companies can reply, and anyone can report a review.</p>
      </section>
      {reviews.length === 0 ? (
        <div className="card stack"><p className="muted">No reviews have been published yet. They appear here after clients complete inspections and deals.</p><p><Link href="/directory">Browse companies and agents</Link></p></div>
      ) : (
        <ShowMore limit={12} noun="more reviews" items={reviews.map((r) => (
          <li key={r.id}>
            <figure className="rv" style={{ margin: 0 }}>
              <span className="rv-stars" role="img" aria-label={`${r.overall} out of 5`}>{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= r.overall ? undefined : "off"} aria-hidden="true">★</span>)}</span>
              <blockquote style={{ margin: 0 }}><q>{r.body}</q></blockquote>
              <footer><span className="avatar" aria-hidden="true">{initials(r.reviewerName)}</span><figcaption><strong>{r.reviewerName}</strong><div className="small muted">About {r.agentUserId ? <Link href={`/agents/${r.agentUserId}`}>{r.about}</Link> : <Link href={`/companies/${r.companyId}`}>{r.about}</Link>} · {formatDate(r.createdAt)}</div></figcaption></footer>
            </figure>
          </li>
        ))} />
      )}
    </div>
  );
}
