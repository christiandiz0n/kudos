import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // @wom/shared is consumed as TypeScript source (D-204).
  transpilePackages: ["@wom/shared"],
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
