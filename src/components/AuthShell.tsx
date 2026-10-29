import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/labels";

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
            <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#FBB017" /><path d="M12 31 32 14l20 17M18 29v21h28V29" fill="none" stroke="#1F2125" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{PLATFORM_NAME}</span>
          </Link>
          <ul className="auth-points">{points.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </aside>
    </div>
  );
}
