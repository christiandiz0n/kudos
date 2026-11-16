import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon } from "./Icon";

export type QRFrameState = "live" | "expired" | "paid";

export interface QRFrameProps {
  /** The QR itself, usually <QrCode value={qrPayload}/>. */
  children: ReactNode;
  /** Seconds until the order expires (caller ticks it). */
  secondsLeft: number;
  totalSeconds: number;
  state?: QRFrameState;
  /** Shown on the expired overlay. */
  onRefresh?: () => void;
  /** Frame edge in px (QR is inset). Default 300. */
  size?: number;
  className?: string;
}

function mmss(s: number) {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

/** Rounded-rect path starting at top-center, clockwise, so the ring drains from 12 o'clock. */
function ringPath(S: number, i: number, r: number) {
  const a = S - i;
  return [
    `M ${S / 2} ${i}`,
    `H ${a - r}`,
    `A ${r} ${r} 0 0 1 ${a} ${i + r}`,
    `V ${a - r}`,
    `A ${r} ${r} 0 0 1 ${a - r} ${a}`,
    `H ${i + r}`,
    `A ${r} ${r} 0 0 1 ${i} ${a - r}`,
    `V ${i + r}`,
    `A ${r} ${r} 0 0 1 ${i + r} ${i}`,
    "Z",
  ].join(" ");
}

/**
 * Frames the venue's order QR with a countdown ring that drains until the signed order expires.
 * Green → amber in the last 20% → expired overlay with a refresh action. `paid` shows a check.
 */
export function QRFrame({ children, secondsLeft, totalSeconds, state = "live", onRefresh, size = 300, className }: QRFrameProps) {
  const frac = state === "live" ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : state === "paid" ? 1 : 0;
  const low = state === "live" && frac <= 0.2;
  const stroke = state === "paid" ? "var(--vx-accent)" : low ? "var(--vx-warning)" : "var(--vx-accent)";
  const d = ringPath(size, 3, 28);

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <path d={d} fill="none" stroke="var(--vx-line)" strokeWidth={5} />
          <path
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${frac * 100} 100`}
            style={{ transition: "stroke-dasharray 1s linear, stroke var(--vx-dur-base) var(--vx-ease-out)" }}
          />
        </svg>
        <div className="absolute inset-[14px] flex items-center justify-center overflow-hidden rounded-[18px] bg-white p-3">
          <div className={cn("w-full transition-opacity duration-[var(--vx-dur-base)]", state !== "live" && "opacity-10")}>{children}</div>
          {state === "expired" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-title-3 text-[#1b1915]">Code expired</p>
              {onRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="focus-ring inline-flex h-12 items-center gap-2 rounded-md bg-[#1b1915] px-5 font-semibold text-white"
                >
                  <Icon name="refresh" size={18} /> New code
                </button>
              ) : null}
            </div>
          ) : null}
          {state === "paid" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="inline-flex size-16 animate-vx-pop items-center justify-center rounded-full bg-[#17694f] text-white">
                <Icon name="check" size={34} strokeWidth={2.5} />
              </span>
              <p className="text-title-3 text-[#1b1915]">Paid</p>
            </div>
          ) : null}
        </div>
      </div>
      <p
        role="timer"
        aria-label={state === "live" ? `Code expires in ${mmss(secondsLeft)}` : undefined}
        className={cn("money text-body-sm font-medium", low ? "text-warning-ink" : "text-ink-2")}
      >
        {state === "live" ? (
          <>
            Expires in <span className="text-ink">{mmss(secondsLeft)}</span>
          </>
        ) : state === "expired" ? (
          "Ask for a new code"
        ) : (
          "Payment received"
        )}
      </p>
    </div>
  );
}
