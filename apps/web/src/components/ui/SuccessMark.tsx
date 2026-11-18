import { cn } from "@/design/cn";

/**
 * The "haptic" moment: green disc pops with a slight overshoot, a ripple rings out once, the check
 * draws itself. ~0.9s total. Under reduced motion it renders the final state instantly.
 * Pair with navigator.vibrate?.(12) in the caller where supported.
 *
 * `pending`: a quiet ink ring that turns while the payment settles. Switching pending → false remounts
 * the disc, so the pop + check play exactly when the money lands.
 */
export function SuccessMark({
  size = 88,
  label = "Payment complete",
  pending = false,
  className,
}: {
  size?: number;
  label?: string;
  pending?: boolean;
  className?: string;
}) {
  return (
    <span role="img" aria-label={label} className={cn("relative inline-flex", className)} style={{ width: size, height: size }}>
      {pending ? (
        <span key="pending" aria-hidden className="relative inline-flex size-full items-center justify-center rounded-full bg-surface-2">
          <span className="absolute inset-1.5 animate-vx-spin rounded-full border-[3px] border-line border-t-ink-2 [animation-duration:1.2s]" />
          <svg viewBox="0 0 24 24" width={size * 0.42} height={size * 0.42} fill="none" className="text-ink-2">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} />
          </svg>
        </span>
      ) : (
        <span key="done" aria-hidden className="contents">
          <span className="vx-ripple absolute inset-0 rounded-full bg-accent" />
          <span className="relative inline-flex size-full animate-vx-pop items-center justify-center rounded-full bg-accent text-on-accent">
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
      )}
    </span>
  );
}
