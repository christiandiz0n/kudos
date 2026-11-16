import type { ReactNode } from "react";
import { cn } from "@/design/cn";

/** KPI tile for the venue dashboard. `value` is usually an <AmountDisplay/> or a tabular number. */
export function Stat({ label, value, caption, className }: { label: string; value: ReactNode; caption?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-caption font-medium text-ink-3">{label}</span>
      <span className="money text-title-1 text-ink">{value}</span>
      {caption ? <span className="text-caption text-ink-3">{caption}</span> : null}
    </div>
  );
}
