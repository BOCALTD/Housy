import { ImageResponse } from "next/og";
import { PLATFORM_NAME } from "@/lib/labels";
import { withPublic } from "@/lib/db";

/**
 * The picture a link preview shows (WhatsApp, Facebook, X, LinkedIn, Telegram): the property's photo beside its price and
 * place, or a profile card, always with the platform's name so people can find their way back. 1200 x 630, the size every
 * network accepts.
 */
export const CARD_SIZE = { width: 1200, height: 630 };

/** The first photo of a published listing that the card renderer can draw (PNG or JPEG), as a data URL. */
export async function cardPhoto(listingId: string): Promise<string | null> {
  const p = await withPublic((tx) => tx.listingPhoto.findFirst({
    where: { listingId, kind: "PHOTO", mimeType: { in: ["image/jpeg", "image/png"] } }, orderBy: { position: "asc" }, select: { mimeType: true, bytes: true },
  })).catch(() => null);
  if (!p || p.bytes.length > 4_000_000) return null;
  return `data:${p.mimeType};base64,${Buffer.from(p.bytes).toString("base64")}`;
}

const AMBER = "#FBB017", INK = "#1F2125", MUTED = "#C9CDD3";

function Mark() {
  return (
    <svg width="44" height="44" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill={AMBER} />
      <path d="M12 31 32 14l20 17" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 29v21h28V29" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function shareCard(o: { photo?: string | null; initials?: string; eyebrow: string; title: string; big?: string; lines: string[]; cta: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: INK, color: "#FFFFFF" }}>
        {o.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.photo} width={600} height={630} style={{ width: 600, height: 630, objectFit: "cover" }} alt="" />
        ) : (
          <div style={{ width: 420, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: "#2A2D33" }}>
            <div style={{ width: 240, height: 240, borderRadius: 120, background: AMBER, color: INK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 96, fontWeight: 700 }}>
              {o.initials || "★"}
            </div>
          </div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 56px 48px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: AMBER }}>{clip(o.eyebrow, 40)}</div>
            <div style={{ marginTop: 18, fontSize: o.title.length > 48 ? 44 : 54, fontWeight: 700, lineHeight: 1.1 }}>{clip(o.title, 80)}</div>
            {o.big ? <div style={{ marginTop: 22, fontSize: 48, fontWeight: 700, color: AMBER }}>{clip(o.big, 32)}</div> : null}
            {o.lines.filter(Boolean).slice(0, 3).map((l) => <div key={l} style={{ marginTop: 12, fontSize: 28, color: MUTED }}>{clip(l, 52)}</div>)}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <Mark />
              <div style={{ marginLeft: 14, fontSize: 30, fontWeight: 700 }}>{PLATFORM_NAME}</div>
            </div>
            <div style={{ fontSize: 24, background: AMBER, color: INK, padding: "10px 20px", borderRadius: 10, fontWeight: 700 }}>{o.cta}</div>
          </div>
        </div>
      </div>
    ),
    CARD_SIZE,
  );
}

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
