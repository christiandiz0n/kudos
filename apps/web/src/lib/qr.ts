/**
 * What a scanned / pasted code means. Venue QRs encode `<web origin>/pay?v=<venue>&o=<orderId>` (the API's
 * `qrPayload` shape, MSG-073), so the phone's native camera opens the pay sheet directly; friends' links are
 * `<web origin>/i/<code>`. We route to the SAME path on the current origin, whatever host the code was made on.
 */
export type ScanTarget = { kind: "pay"; venue: string; orderId: string; path: string } | { kind: "intro"; code: string; path: string };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;

export function parseScan(raw: string): ScanTarget | null {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text, "https://vouch.invalid");
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/pay")) {
    const v = url.searchParams.get("v") ?? "";
    const o = url.searchParams.get("o") ?? "";
    if (ADDR.test(v) && B32.test(o)) return { kind: "pay", venue: v, orderId: o, path: `/pay?v=${v}&o=${o}` };
  }
  const m = /\/i\/([0-9A-Za-z]{4,32})$/.exec(path);
  if (m) return { kind: "intro", code: m[1]!, path: `/i/${m[1]}` };
  return null;
}
