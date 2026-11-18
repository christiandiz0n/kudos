"use client";

/** Toast queue (UI kit leaves the queue to us, MSG-006). Max 3 visible; auto-dismiss after `ms`. */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Toast, ToastViewport, type ToastTone } from "@/components/ui";

export interface ToastInput {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** 0 = sticky. Default 5 s. */
  ms?: number;
  /** Replaces an existing toast with the same key. */
  key?: string;
}
interface Item extends ToastInput {
  id: number;
}
interface Ctx {
  push: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<Ctx>({ push: () => 0, dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((xs) => [...xs.filter((x) => !t.key || x.key !== t.key), { ...t, id }].slice(-3));
      const ms = t.ms ?? 5000;
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <ToastViewport>
        {items.map((t) => (
          <Toast key={t.id} tone={t.tone} title={t.title} description={t.description} action={t.action} onDismiss={() => dismiss(t.id)} />
        ))}
      </ToastViewport>
    </ToastCtx.Provider>
  );
}

export function useToasts(): Ctx {
  return useContext(ToastCtx);
}
