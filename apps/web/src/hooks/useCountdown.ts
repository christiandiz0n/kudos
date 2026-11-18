"use client";

import { useEffect, useState } from "react";

/** Seconds left until `deadlineMs` (epoch ms), ticking every 250 ms. null deadline → 0. */
export function useCountdown(deadlineMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineMs) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadlineMs]);
  if (!deadlineMs) return 0;
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}
