import type { ReactNode } from "react";
import { cn } from "@/design/cn";

export type BadgeTone = "neutral" | "accent" | "warning" | "danger" | "solid";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  solid: "bg-ink text-on-ink",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Small leading dot (e.g. "Live"). */
  dot?: boolean;
  className?: string;
}

export function Badge({ tone = "neutral", children, dot, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
