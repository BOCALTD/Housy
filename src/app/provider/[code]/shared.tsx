import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { providerContext, providerProfile, type VpCtx } from "@/lib/services/verification-network";
import { VP_ROLE_LABELS } from "@/lib/verification-network-rules";

/** Who is looking, in which organisation; a page for an organisation the person is not in does not exist for them. */
export async function orgFor(code: string): Promise<VpCtx> {
  const user = await requireUser();
  const ctx = await providerContext(user.id, decodeURIComponent(code));
  if (!ctx) notFound();
  return ctx;
}

/** The organisation's own header on every page of its dashboard: its name and logo, within Housy's design. */
export async function OrgHeader({ ctx, title, back = true }: { ctx: VpCtx; title?: string; back?: boolean }) {
  const p = await providerProfile(ctx);
  return (
    <header className="vp-org">
      <div className="vp-org-id">
        {p.logoMime
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="vp-logo" src={`/provider/logo/${p.id}`} alt="" width={56} height={56} />
          : <span className="vp-logo vp-logo-initials" aria-hidden="true">{p.shortName.slice(0, 2).toUpperCase()}</span>}
        <div className="stack" style={{ gap: 2 }}>
          {back ? <Link className="small" href={`/provider/${ctx.code}`}>{p.name}</Link> : null}
          <h1>{title ?? `${p.name} verification dashboard`}</h1>
          <p className="small muted">Provider {p.providerCode} · You: {VP_ROLE_LABELS[ctx.role]}</p>
        </div>
      </div>
      {p.suspendedAt ? <div className="flash error" role="status"><strong>Suspended by Housy.</strong> {p.suspendedReason} Your records are kept and can be read; nothing can be changed and no new work comes in until the suspension is lifted.</div> : null}
    </header>
  );
}
