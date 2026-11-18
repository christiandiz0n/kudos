/**
 * Browser-visible config. Only public values here (NEXT_PUBLIC_* is inlined into the client bundle).
 * Never put a secret in this file or in a NEXT_PUBLIC_* var.
 */
const DEFAULT_API_URL = "https://api-production-902bc54c.up.railway.app";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, "");

/**
 * Feature flags for endpoints that BACKEND_RELAYER is adding but may not be deployed yet.
 * "auto" (default): call it and treat a 404 NOT_FOUND as "not available" (hide the UI).
 * "on": always show. "off": never call.
 */
export type FlagMode = "auto" | "on" | "off";
function flag(v: string | undefined): FlagMode {
  return v === "on" || v === "off" ? v : "auto";
}
export const FLAGS = {
  /** POST/GET /demo/topup (once-per-wallet testnet top-up, D-019 #4). */
  demoTopup: flag(process.env.NEXT_PUBLIC_FLAG_DEMO_TOPUP),
  /** GET /venues/:venue/payments (venue feed history). */
  venuePayments: flag(process.env.NEXT_PUBLIC_FLAG_VENUE_PAYMENTS),
} as const;

/**
 * Origin encoded into venue QR codes and share links. Defaults to the origin the page is served from, so a QR shown
 * on a tunnel / Vercel URL opens the same deployment in the phone's native camera (D-9xx). Override with
 * NEXT_PUBLIC_WEB_URL when the counter screen runs on a different host than the customer app.
 */
export function webOrigin(): string {
  const fixed = process.env.NEXT_PUBLIC_WEB_URL;
  if (fixed) return fixed.replace(/\/$/, "");
  return typeof window === "undefined" ? "" : window.location.origin;
}
