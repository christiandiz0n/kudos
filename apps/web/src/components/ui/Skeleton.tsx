import { cn } from "@/design/cn";

/** Loading placeholder. Shimmer stops under reduced motion (tokens.css). */
export function Skeleton({ className, rounded = "md" }: { className?: string; rounded?: "sm" | "md" | "full" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-vx-shimmer bg-[linear-gradient(90deg,var(--vx-surface-2)_0%,var(--vx-surface-3)_50%,var(--vx-surface-2)_100%)] bg-[length:200%_100%]",
        rounded === "full" ? "rounded-full" : rounded === "sm" ? "rounded-xs" : "rounded-sm",
        className,
      )}
    />
  );
}

/** A ListItem-shaped skeleton row. Wrap groups in a container with aria-busy + an sr-only "Loading". */
export function SkeletonRow() {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2.5">
      <Skeleton rounded="full" className="size-10" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-4 w-14" />
    </div>
  );
}
