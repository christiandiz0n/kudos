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
          className="focus-ring money flex h-16 items-center justify-center rounded-md text-title-2 text-ink transition-colors duration-[var(--vx-dur-instant)] hover:bg-surface-2 active:bg-surface-3 disabled:text-ink-3"
        >
          {k === "back" ? <Icon name="backspace" size={24} /> : k}
        </button>
      ))}
    </div>
  );
}
