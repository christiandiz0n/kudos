import type { ReactNode } from "react";
import { cn } from "@/design/cn";

/**
 * Screen scaffolding for 390px mobile layouts:
 *   <Screen header={<AppBar …/>} footer={<Button block size="lg">Pay $12.00</Button>}>…</Screen>
 * The footer is the thumb zone: exactly one primary action lives there.
 * The footer is opaque (content scrolls cleanly under it, never through a caption) with a short fade above it;
 * `data-vx-footer` lets tokens.css add matching scroll-padding so a focused field is never left behind it (QE-3-02).
 */
export function Screen({ header, footer, children, className, tone = "canvas" }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string; tone?: "canvas" | "surface" }) {
  return (
    <div className={cn("flex h-full min-h-full flex-1 flex-col", tone === "canvas" ? "bg-canvas" : "bg-surface", className)}>
      {header}
      <main className="flex-1 overflow-y-auto px-[var(--vx-gutter)] pb-6">{children}</main>
      {footer ? (
        <div
          data-vx-footer
          className={cn(
            "sticky bottom-0 z-10 px-[var(--vx-gutter)] pt-3 pb-[max(env(safe-area-inset-bottom),20px)]",
            "before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:content-['']",
            tone === "canvas" ? "bg-canvas before:from-canvas before:to-canvas/0" : "bg-surface before:from-surface before:to-surface/0",
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function AppBar({ title, leading, trailing, large }: { title?: ReactNode; leading?: ReactNode; trailing?: ReactNode; large?: boolean }) {
  return (
    <header className="px-[var(--vx-gutter)] pt-3">
      <div className="flex h-12 items-center gap-2">
        <div className="-ml-3 flex min-w-12 items-center">{leading}</div>
        {!large && title ? <h1 className="flex-1 truncate text-center text-body font-semibold text-ink">{title}</h1> : <div className="flex-1" />}
        <div className="-mr-3 flex min-w-12 items-center justify-end">{trailing}</div>
      </div>
      {large && title ? <h1 className="pt-1 pb-2 text-title-1 text-ink">{title}</h1> : null}
    </header>
  );
}

/** Small uppercase-free section label, e.g. "Recent". */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-1 flex items-center justify-between">
      <h2 className="text-body-sm font-semibold text-ink-2">{children}</h2>
      {action}
    </div>
  );
}
