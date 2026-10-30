import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/labels";
import { Logo } from "./Logo";

/** Sign-in and sign-up pages: a photograph with what the account gives, beside the form. On phones the form comes first. */
export function AuthShell({ eyebrow, title, intro, points, photo = "/stock/hero-2.jpg", children, foot }: {
  eyebrow: string; title: string; intro?: string; points: string[]; photo?: string; children: React.ReactNode; foot?: React.ReactNode;
}) {
  return (
    <div className="auth">
      <div className="auth-main">
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {intro ? <p className="muted">{intro}</p> : null}
        </div>
        {children}
        {foot ? <div className="auth-foot small muted">{foot}</div> : null}
      </div>
      <aside className="auth-art" aria-label={`Why ${PLATFORM_NAME}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="" loading="lazy" decoding="async" />
        <div className="auth-art-inner">
          <Link href="/" className="auth-brand" aria-label={`${PLATFORM_NAME} home`}>
            <Logo size={36} tone="light" />
          </Link>
          <ul className="auth-points">{points.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </aside>
    </div>
  );
}
