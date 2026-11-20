"use client";

import { cn } from "@/design/cn";
import { Icon } from "./Icon";

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

const KEYS: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

/**
 * Counter keypad for staff order entry (big 64px keys, works with gloves/one hand).
 * The caller owns the amount string and parses it with @vouch/shared parseUsdc.
 */
export function Keypad({ onKey, disabled, className }: { onKey: (key: KeypadKey) => void; disabled?: boolean; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onKey(k)}
          aria-label={k === "back" ? "Delete" : k === "." ? "Decimal point" : k}
          className="focus-ring money flex h-16 items-center justify-center rounded-md bg-surface text-title-2 text-ink shadow-1 ring-1 ring-line transition-[background-color,transform] duration-[var(--vx-dur-instant)] ease-out hover:bg-primary-soft active:scale-[0.97] active:bg-primary-soft-2 disabled:text-ink-3 disabled:active:scale-100"
        >
          {k === "back" ? <Icon name="backspace" size={24} /> : k}
        </button>
      ))}
    </div>
  );
}
