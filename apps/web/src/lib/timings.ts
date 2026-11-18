/**
 * Demo evidence: per-payment timings (Face ID → relay 202 → Streams "settled"), kept in sessionStorage and on
 * `window.__vouchTimings` so the two-device runbook and Playwright can read them. Never contains secrets.
 */
export interface Timing {
  at: string;
  orderId: string;
  intentId: string;
  txHash: string;
  step: "pending" | "settled";
  via?: "sse" | "poll";
  faceIdMs?: number;
  relayMs?: number;
  settleMs?: number;
}

export function recordTiming(t: Omit<Timing, "at">): void {
  const row: Timing = { at: new Date().toISOString(), ...t };
  try {
    const w = window as unknown as { __vouchTimings?: Timing[] };
    (w.__vouchTimings ??= []).push(row);
    const prev = JSON.parse(sessionStorage.getItem("vouch.timings") ?? "[]") as Timing[];
    sessionStorage.setItem("vouch.timings", JSON.stringify([...prev, row].slice(-50)));
  } catch {
    /* ignore */
  }
  console.info("[vouch] timing", row);
}
