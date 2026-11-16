import { cn } from "@/design/cn";

/**
 * The "haptic" moment: green disc pops with a slight overshoot, a ripple rings out once, the check
 * draws itself. ~0.9s total. Under reduced motion it renders the final state instantly.
 * Pair with navigator.vibrate?.(12) in the caller where supported.
 */
export function SuccessMark({ size = 88, label = "Payment complete", className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role="img" aria-label={label} className={cn("relative inline-flex", className)} style={{ width: size, height: size }}>
      <span aria-hidden className="vx-ripple absolute inset-0 rounded-full bg-accent" />
      <span aria-hidden className="relative inline-flex size-full animate-vx-pop items-center justify-center rounded-full bg-accent text-on-accent">
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="vx-draw"
          />
        </svg>
      </span>
    </span>
  );
}
