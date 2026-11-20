import type { HTMLAttributes } from "react";
import { cn } from "@/design/cn";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** `raised` white on paper (default) · `sunken` well · `accent` soft green (money moments) · `outline` hairline only · `primary` soft blue (info). */
  tone?: "raised" | "sunken" | "accent" | "outline" | "primary";
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article";
}

const tones = {
  raised: "bg-surface shadow-1 ring-1 ring-line/70",
  sunken: "bg-surface-2",
  accent: "bg-accent-soft",
  /** Soft blue tint: informational highlight (not money). */
  primary: "bg-primary-soft",
  outline: "bg-transparent ring-1 ring-line",
} as const;
const pads = { none: "", sm: "p-3", md: "p-4", lg: "p-5" } as const;

export function Card({ tone = "raised", padding = "md", as: Tag = "div", className, ...rest }: CardProps) {
  return <Tag className={cn("rounded-lg", tones[tone], pads[padding], className)} {...rest} />;
}
