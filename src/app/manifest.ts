import type { MetadataRoute } from "next";
import { PLATFORM_NAME } from "@/lib/labels";

// The installable app (master prompt §49). Opens on the public home page; signed-in areas still need the network.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PLATFORM_NAME,
    short_name: PLATFORM_NAME,
    description: "Find verified property, book inspections safely, and manage property portfolios.",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1F2125", // the splash screen: ink, behind the ink app icon
    theme_color: "#1F2125",
    categories: ["business", "lifestyle", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Browse property", url: "/browse", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My account", url: "/me", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Field kit", url: "/field", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Company workspace", url: "/app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
