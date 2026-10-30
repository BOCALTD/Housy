import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_NAME } from "@/lib/labels";

// The picture shown when the site is shared on WhatsApp, Facebook, X, LinkedIn or Telegram, or found on Google: the logo,
// name and promise beside a property photograph. It follows NEXT_PUBLIC_PLATFORM_NAME.
export const alt = `${PLATFORM_NAME}: verified property and property management in Nigeria`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function asset(name: string) {
  try { return readFileSync(join(process.cwd(), "src/assets", name)); } catch { return null; }
}

export default function OpengraphImage() {
  const photo = asset("og-photo.jpg");
  const bold = asset("fonts/Inter-Bold.otf"), medium = asset("fonts/Inter-Medium.otf");
  const fonts = bold && medium ? [{ name: "Inter", data: bold, weight: 700 as const, style: "normal" as const }, { name: "Inter", data: medium, weight: 500 as const, style: "normal" as const }] : [];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#1F2125", color: "#FFFFFF", fontFamily: "Inter" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 56px 56px 72px" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg width="76" height="76" viewBox="0 0 64 64">
              <rect width="64" height="64" rx="14" fill="#FBB017" />
              <path d="M12 31 32 14l20 17" fill="none" stroke="#1F2125" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18 29v21h28V29" fill="none" stroke="#1F2125" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="27" y="36" width="10" height="14" rx="2" fill="#FFFFFF" />
            </svg>
            <div style={{ marginLeft: 20, fontSize: 40, fontWeight: 700 }}>{PLATFORM_NAME}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1 }}>Find property you can trust.</div>
            <div style={{ marginTop: 22, fontSize: 30, color: "#C9CDD3", lineHeight: 1.35 }}>Verified companies and agents, inspections booked safely, and rent and documents in one place.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ fontSize: 24, background: "#FBB017", color: "#1F2125", padding: "12px 24px", borderRadius: 12, fontWeight: 700 }}>Join free</div>
            <div style={{ marginLeft: 20, fontSize: 24, color: "#C9CDD3" }}>Buy · Rent · Lease · Flatmates</div>
          </div>
        </div>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/jpeg;base64,${photo.toString("base64")}`} width={560} height={630} style={{ width: 560, height: 630, objectFit: "cover" }} alt="" />
        ) : <div style={{ width: 560, height: 630, display: "flex", background: "#2A2D33" }} />}
      </div>
    ),
    { ...size, fonts },
  );
}
