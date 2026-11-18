import type { MetadataRoute } from "next";

/**
 * Web app manifest (add to home screen; phone checklist). Colors are design tokens: canvas #f6f4ef (--vx-canvas,
 * same as the light `themeColor` in layout.tsx). Icons come from scripts/phase3-icons.ts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vouch",
    short_name: "Vouch",
    description: "Pay local. Thank the friends who sent you.",
    id: "/",
    start_url: "/", // signed in → /wallet; venue staff go on to /venue from there
    scope: "/",
    display: "standalone",
    background_color: "#f6f4ef",
    theme_color: "#f6f4ef",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
