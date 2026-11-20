import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon, type IconName } from "./Icon";

export type EmptyStateTone = "neutral" | "warning" | "danger" | "accent" | "primary";

const toneDisc: Record<EmptyStateTone, string> = {
  neutral: "bg-primary-soft text-primary-ink",
  primary: "bg-primary-soft text-primary-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  accent: "bg-accent-soft text-accent-ink",
};

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  /** One or two buttons. The first should be the way forward. */
  action?: ReactNode;
  /** Icon disc color. Errors use `warning` (recoverable) or `danger` (failed); never red for spending. */
  tone?: EmptyStateTone;
  /** `alert` for errors that just happened (announced), `status` for calm states. */
  role?: "alert" | "status";
  className?: string;
}

/** Empty, error and blocked states: icon, title, one or two calm sentences, the way forward. */
export function EmptyState({ icon = "receipt", title, body, action, tone = "neutral", role, className }: EmptyStateProps) {
  return (
    <div role={role} className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <span className={cn("mb-4 inline-flex size-14 items-center justify-center rounded-full", toneDisc[tone])}>
        <Icon name={icon} size={26} />
      </span>
      <p className="text-title-3 text-ink">{title}</p>
      {body ? <div className="mt-1 max-w-[32ch] text-body-sm text-ink-2">{body}</div> : null}
      {action ? <div className="mt-5 flex w-full flex-col items-center gap-2">{action}</div> : null}
    </div>
  );
}
