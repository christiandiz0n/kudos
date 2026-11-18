import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // D-017 (f): hide the Next dev badge (it covers the bottom-left of phone screenshots).
  devIndicators: false,
  // @vouch/shared is consumed as TypeScript source (D-204).
  transpilePackages: ["@vouch/shared"],
  // Phone testing over LAN IP or an HTTPS tunnel (camera requires a secure context).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.trycloudflare.com", "*.ngrok-free.app"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
