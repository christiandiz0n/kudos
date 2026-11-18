/**
 * Browser-visible config. Only public values here (NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, so
 * on Vercel they must be set before the build). Never put a secret in this file or in a NEXT_PUBLIC_* var.
 *
 *   NEXT_PUBLIC_API_URL   the api base URL (default: the hosted Railway api); trailing slashes, query and hash dropped.
 *   NEXT_PUBLIC_WEB_URL   optional fixed origin for QR codes and share links (default: the page's own origin).
 *   NEXT_PUBLIC_FLAG_*    auto | on | off (see FLAGS).
 */
const DEFAULT_API_URL = "https://api-production-902bc54c.up.railway.app";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/;

/** `https://host[:port]` from a configured value, or null if it isn't an absolute http(s) URL. */
export function originOf(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

function apiBase(raw: string | undefined): string | null {
  const origin = originOf(raw);
  return origin ? origin + new URL(raw!.trim()).pathname.replace(/\/+$/, "") : null;
}

export const API_URL = apiBase(process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_API_URL;

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

const FIXED_WEB_ORIGIN = originOf(process.env.NEXT_PUBLIC_WEB_URL);

/**
 * Origin encoded into venue QR codes and share links (D-901). Defaults to the origin the page is served from, so a QR
 * shown on the Vercel / tunnel URL opens the same deployment in the phone's native camera. NEXT_PUBLIC_WEB_URL pins it
 * (e.g. the production domain when the counter runs on a preview URL). A pinned localhost origin is ignored when the
 * page itself is NOT on localhost: a phone can never open it, so a dev value baked into a deployed build can't break
 * every QR (D-907).
 */
export function webOrigin(): string {
  const here = typeof window === "undefined" ? null : window.location.origin;
  if (FIXED_WEB_ORIGIN) {
    const fixedIsLocal = LOCAL_HOST.test(new URL(FIXED_WEB_ORIGIN).hostname);
    const hereIsLocal = here ? LOCAL_HOST.test(new URL(here).hostname) : true;
    if (!fixedIsLocal || hereIsLocal) return FIXED_WEB_ORIGIN;
  }
  return here ?? "";
}
