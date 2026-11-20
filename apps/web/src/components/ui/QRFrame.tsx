import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon } from "./Icon";

/** live → (processing: customer confirmed, settling) → paid · live → expired → refreshing → live. */
export type QRFrameState = "live" | "processing" | "refreshing" | "expired" | "paid";

export interface QRFrameProps {
  /** The QR itself, usually <QrCode value={qrPayload}/>. */
  children: ReactNode;
  /** Seconds until the order expires (caller ticks it). */
  secondsLeft: number;
  totalSeconds: number;
  state?: QRFrameState;
  /** Shown on the expired overlay. */
  onRefresh?: () => void;
  /** Expired codes are replaced automatically (caller re-creates the order): the caption says so. */
  autoRefresh?: boolean;
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
 * Blue → amber in the last 20% → expired overlay with a refresh action. `paid` shows a check.
 */
export function QRFrame({ children, secondsLeft, totalSeconds, state = "live", onRefresh, autoRefresh, size = 300, className }: QRFrameProps) {
  const frac = state === "live" ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : state === "paid" || state === "processing" ? 1 : 0;
  const low = state === "live" && frac <= 0.2;
  const stroke = state === "processing" ? "var(--vx-ink-2)" : low ? "var(--vx-warning)" : "var(--vx-primary)";
  const d = ringPath(size, 3, 28);

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <path d={d} fill="none" stroke="var(--vx-primary-soft-2)" strokeWidth={5} />
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
          <div className={cn("w-full transition-opacity duration-[var(--vx-dur-base)]", state !== "live" && "opacity-10 blur-[3px]")}>{children}</div>
          {state === "expired" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-title-3 text-[#15202e]">Code expired</p>
              {onRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="focus-ring inline-flex h-12 items-center gap-2 rounded-md bg-[#4075ad] px-5 font-semibold text-white hover:bg-[#36659a]"
                >
                  <Icon name="refresh" size={18} /> New code
                </button>
              ) : null}
            </div>
          ) : null}
          {state === "processing" || state === "refreshing" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <span aria-hidden className="size-12 animate-vx-spin rounded-full border-4 border-[#d4e3f3] border-t-[#4075ad]" />
              <p className="text-title-3 text-[#15202e]">{state === "processing" ? "Payment on its way…" : "Getting a new code…"}</p>
            </div>
          ) : null}
          {state === "paid" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="inline-flex size-16 animate-vx-pop items-center justify-center rounded-full bg-[#4075ad] text-white">
                <Icon name="check" size={34} strokeWidth={2.5} />
              </span>
              <p className="text-title-3 text-[#15202e]">Paid</p>
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
          autoRefresh ? "A new code appears automatically" : "Tap New code, then show it again"
        ) : state === "refreshing" ? (
          "One moment"
        ) : state === "processing" ? (
          "Confirming the payment, usually 2–3 seconds"
        ) : (
          "Payment received"
        )}
      </p>
    </div>
  );
}
