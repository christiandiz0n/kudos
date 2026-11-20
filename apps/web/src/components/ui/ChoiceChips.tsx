"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/design/cn";
import { Avatar } from "./Avatar";

export interface ChoiceChip {
  value: string;
  label: string;
  /** Show an initials avatar (people). */
  person?: boolean;
  /** De-emphasized option, e.g. "Skip" (no outline, secondary ink). */
  quiet?: boolean;
}

export interface ChoiceChipsProps {
  label: string;
  options: ChoiceChip[];
  /** null = nothing chosen (skipping is always allowed). */
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}

/**
 * Single-choice chips, e.g. "Who sent you here?" → Ana · Priya · Someone else.
 * Radio-group semantics; tapping the selected chip clears it (the answer is optional).
 */
export function ChoiceChips({ label, options, value, onChange, className }: ChoiceChipsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.findIndex((o) => o.value === value);
  const focusIndex = current < 0 ? 0 : current;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (focusIndex + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(selected ? null : o.value)}
            className={cn(
              "focus-ring inline-flex h-11 items-center gap-2 rounded-full pr-4 text-body-sm font-semibold transition-[background-color,box-shadow,color] duration-[var(--vx-dur-fast)]",
              o.person ? "pl-1.5" : "pl-4",
              selected
                ? "bg-primary text-on-primary shadow-1"
                : o.quiet
                  ? "bg-transparent font-medium text-ink-2 underline decoration-line-strong underline-offset-4 hover:bg-surface-2"
                  : "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--vx-line)] hover:bg-primary-soft hover:shadow-[inset_0_0_0_1px_var(--vx-primary-soft-2)]",
            )}
          >
            {o.person ? <Avatar name={o.label} size="sm" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
