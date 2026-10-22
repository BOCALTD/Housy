import { ImageResponse } from "next/og";
import { PLATFORM_NAME } from "@/lib/labels";

// The picture shown when a link is shared or found on Google. It uses the platform name, so it follows NEXT_PUBLIC_PLATFORM_NAME.
export const alt = `${PLATFORM_NAME}: verified property and property management`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#1F2125", color: "#FFFFFF" }}>
        <svg width="132" height="132" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="14" fill="#FBB017" />
          <path d="M12 31 32 14l20 17" fill="none" stroke="#1F2125" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18 29v21h28V29" fill="none" stroke="#1F2125" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="27" y="36" width="10" height="14" rx="2" fill="#FFFFFF" />
        </svg>
        <div style={{ marginTop: 48, fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>{PLATFORM_NAME}</div>
        <div style={{ marginTop: 16, fontSize: 40, color: "#D6D9DE" }}>Verified property and property management, in one place.</div>
        <div style={{ marginTop: 56, width: 160, height: 8, background: "#FBB017", borderRadius: 4 }} />
      </div>
    ),
    size,
  );
}
