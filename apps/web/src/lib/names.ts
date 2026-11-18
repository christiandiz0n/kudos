/**
 * Address → display name ("Ana"). Primary screens never show addresses (COPY.md), so unknown people are "A friend".
 * Names come from the API user record via GET /ambassadors/:address (public) and are cached for the tab.
 */
import { api } from "./api";

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function cachedName(address: string | null | undefined): string | null {
  return address ? (cache.get(address.toLowerCase()) ?? null) : null;
}

export function rememberName(address: string, name: string | null | undefined): void {
  if (name) cache.set(address.toLowerCase(), name);
}

export async function resolveName(address: string): Promise<string | null> {
  const k = address.toLowerCase();
  if (cache.has(k)) return cache.get(k)!;
  if (!inflight.has(k)) {
    inflight.set(
      k,
      api
        .ambassador(address)
        .then((a) => a.displayName ?? null)
        .catch(() => null)
        .then((n) => {
          cache.set(k, n);
          inflight.delete(k);
          return n;
        }),
    );
  }
  return inflight.get(k)!;
}

export async function resolveNames(addresses: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(addresses.filter(Boolean).map((a) => a.toLowerCase()))];
  const names = await Promise.all(uniq.map(resolveName));
  const out: Record<string, string> = {};
  uniq.forEach((a, i) => (out[a] = names[i] ?? "A friend"));
  return out;
}

export function nameOr(map: Record<string, string>, address: string | null | undefined, fallback = "A friend"): string {
  return (address && map[address.toLowerCase()]) || fallback;
}
