"use client";

/**
 * SSE subscription (INTERFACES §5): /events/user/:address?token= (own address; EventSource can't set headers, so the
 * token goes in the query ONLY here, D-809) and /events/venue/:venue (public). Reconnects with backoff when the server
 * closes (30-min max age, caps → 429). `connected` lets callers speed up their polling fallback while SSE is down.
 */
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/config";
import { useSession } from "@/state/session";

export const LIVE_EVENTS = [
  "payment.pending",
  "payment.failed",
  "payment.settled",
  "reward.paid",
  "intro.pending",
  "intro.failed",
  "intro.accepted",
  "intro.dropped",
  "customer.verified",
  "venue.pending",
  "venue.failed",
  "venue.registered",
  "venue.action.pending",
  "venue.action.failed",
  "terms.updated",
  "venue.keys",
  "seed.set",
  "wallet.topup",
] as const;
export type LiveEventName = (typeof LIVE_EVENTS)[number];
export type LiveHandler = (name: LiveEventName, data: Record<string, unknown>) => void;

export type LiveStatus = "connecting" | "live" | "reconnecting";

export function useLiveEvents(channel: { kind: "user" | "venue"; id: string | null | undefined }, onEvent: LiveHandler): { connected: boolean; status: LiveStatus } {
  const session = useSession();
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const token = channel.kind === "user" ? session?.token : undefined;
  const id = channel.id?.toLowerCase();

  useEffect(() => {
    if (!id || (channel.kind === "user" && !token)) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;
    const url =
      channel.kind === "user"
        ? `${API_URL}/events/user/${id}?token=${encodeURIComponent(token!)}`
        : `${API_URL}/events/venue/${id}`;

    const open = () => {
      if (closed) return;
      es = new EventSource(url);
      es.onopen = () => {
        attempt = 0;
        setStatus("live");
      };
      es.onerror = () => {
        setStatus((s) => (s === "connecting" ? "connecting" : "reconnecting"));
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          const delay = Math.min(30_000, 1500 * 2 ** attempt++);
          timer = setTimeout(open, delay);
        }
      };
      for (const name of LIVE_EVENTS) {
        es.addEventListener(name, (ev) => {
          try {
            handler.current(name, JSON.parse((ev as MessageEvent).data));
          } catch {
            /* malformed event: ignore */
          }
        });
      }
    };
    open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [channel.kind, id, token]);

  return { connected: status === "live", status };
}
