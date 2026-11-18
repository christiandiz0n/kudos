/** Which account (if any) lives on this device. IndexedDB is async, so `undefined` = still loading. */
import { useEffect, useState } from "react";
import { loadWallet, type StoredWallet } from "@/lib/wallet";

const listeners = new Set<() => void>();
export function notifyWalletChanged(): void {
  listeners.forEach((l) => l());
}

export function useDeviceWallet(): StoredWallet | null | undefined {
  const [w, setW] = useState<StoredWallet | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      loadWallet()
        .then((x) => alive && setW(x))
        .catch(() => alive && setW(null));
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, []);
  return w;
}
