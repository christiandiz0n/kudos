/**
 * Session token store (D-802/D-809: `Authorization: Bearer` only, no cookies). Kept in localStorage so a reload or a
 * new tab stays signed in until the token expires; cleared on logout or when the device's account changes.
 * A tiny external store so components read it with useSyncExternalStore (server snapshot = null, no hydration diff).
 */
import { useSyncExternalStore } from "react";

export interface SessionUser {
  address: string;
  displayName: string | null;
  [k: string]: unknown;
}
export interface Session {
  token: string;
  /** ISO string or epoch ms/s as returned by /auth/verify. */
  expiresAt: string | number;
  address: string;
  user: SessionUser | null;
}

const KEY = "vouch.session.v1";
const listeners = new Set<() => void>();
let cache: Session | null | undefined;

function expiryMs(s: Session): number {
  const e = s.expiresAt;
  if (typeof e === "number") return e < 1e12 ? e * 1000 : e;
  const n = Date.parse(e);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

function read(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s?.token || expiryMs(s) <= Date.now() + 30_000) return null;
    return s;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (cache === undefined) cache = read();
  return cache;
}

export function setSession(s: Session | null): void {
  cache = s;
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the session lives for this tab only */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = read();
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, () => null);
}
