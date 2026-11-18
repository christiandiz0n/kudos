import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon, type IconName } from "./Icon";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

const toneIcon: Record<ToastTone, IconName> = { neutral: "info", success: "check", warning: "alert", danger: "alert" };
const toneIconClass: Record<ToastTone, string> = {
  neutral: "bg-ink text-on-ink",
  success: "bg-accent text-on-accent",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
};

export interface ToastProps {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  /** e.g. <button>View</button> */
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Presentational toast. Live updates ("Ana's recommendation just paid her $0.69") land here.
 * Queueing/timers belong to the caller; render inside <ToastViewport/> so screen readers hear it.
 */
export function Toast({ tone = "neutral", title, description, action, onDismiss, className }: ToastProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full animate-vx-rise-in items-start gap-3 rounded-lg bg-surface p-3 pr-2 shadow-2 ring-1 ring-line",
        className,
      )}
    >
      <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full", toneIconClass[tone])}>
        <Icon name={toneIcon[tone]} size={16} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-body-sm font-semibold text-ink">{title}</p>
        {description ? <p className="text-caption text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="focus-ring -my-1 -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2"
        >
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** Fixed region at the top of the viewport (above the thumb zone, away from the primary action). */
export function ToastViewport({ children, inline }: { children: ReactNode; inline?: boolean }) {
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className={cn(
        "pointer-events-none flex flex-col gap-2",
        inline ? "w-full" : "fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-[60] mx-auto w-full max-w-[420px] px-3",
      )}
    >
      {children}
    </div>
  );
}
