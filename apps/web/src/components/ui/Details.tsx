import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon } from "./Icon";

/**
 * The "Details" drawer: the ONLY place on primary screens where technical facts may appear
 * (network, receipt ID, fee covered, contract). Collapsed by default. Native <details> = keyboard +
 * screen-reader support for free. `data-copy-scope="details"` exempts it from the banned-words check.
 */
export function Details({ summary = "Details", children, className }: { summary?: string; children: ReactNode; className?: string }) {
  return (
    <details data-copy-scope="details" className={cn("group rounded-md bg-surface-2", className)}>
      <summary className="focus-ring flex min-h-12 cursor-pointer list-none items-center justify-between rounded-md px-4 text-body-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
        {summary}
        <Icon name="chevronDown" size={18} className="transition-transform duration-[var(--vx-dur-fast)] group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 text-caption text-ink-2">{children}</div>
    </details>
  );
}

/** Key/value row for inside <Details/>. Values are mono + break anywhere (hashes). */
export function DetailRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-ink-3">{label}</span>
      <span className={cn("text-right text-ink-2", mono && "font-mono text-[0.75rem] break-all")}>{value}</span>
    </div>
  );
}
