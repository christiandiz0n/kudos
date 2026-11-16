"use client";

import { useId, type CSSProperties } from "react";
import { cn } from "@/design/cn";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Human value, also used as aria-valuetext ("15%"). */
  formatValue?: (value: number) => string;
  /** Labels under the ends of the track. */
  minLabel?: string;
  maxLabel?: string;
  hint?: string;
  className?: string;
}

/** Native range input (keyboard, screen readers, touch for free), styled via .vx-range in tokens.css. */
export function Slider({ label, value, min, max, step = 1, onChange, formatValue = String, minLabel, maxLabel, hint, className }: SliderProps) {
  const id = useId();
  const hintId = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-body-sm font-medium text-ink-2">
          {label}
        </label>
        <output htmlFor={id} className="money text-title-2 text-ink">
          {formatValue(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="vx-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={formatValue(value)}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--vx-fill": `${fill}%` } as CSSProperties}
      />
      {minLabel || maxLabel ? (
        <div className="-mt-1 flex justify-between text-caption text-ink-3" aria-hidden>
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-2 text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
