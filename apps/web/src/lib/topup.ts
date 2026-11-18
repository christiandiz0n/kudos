/**
 * "Top up (testnet demo)" (D-019 #4): BACKEND_RELAYER's once-per-wallet POST /demo/topup. Feature-flagged
 * (NEXT_PUBLIC_FLAG_DEMO_TOPUP=auto|on|off): in "auto", a 404 means the endpoint isn't deployed yet.
 */
import { ApiError, api, friendlyError, money } from "./api";
import { FLAGS } from "./config";

export class TopupUnavailable extends Error {}

export async function demoTopup(): Promise<void> {
  if (FLAGS.demoTopup === "off") throw new TopupUnavailable("Demo top-up isn't available here.");
  const before = await api.wallet().then((w) => money(w.balance)).catch(() => null);
  try {
    await api.demoTopup();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === "NOT_FOUND")
      throw new TopupUnavailable("Demo top-up isn't live yet. Ask the host to add money to your account.");
    throw new TopupUnavailable(friendlyError(e));
  }
  // POST answers 202 pending (D-811); wait (≤ 20 s) for the balance to move so the next quote sees it.
  const t0 = Date.now();
  while (before !== null && Date.now() - t0 < 20_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const now = await api.wallet().then((w) => money(w.balance)).catch(() => before);
    if (now > before) return;
  }
}
