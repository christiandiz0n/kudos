import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon = "receipt", title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-2">
        <Icon name={icon} size={26} />
      </span>
      <p className="text-title-3 text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-[30ch] text-body-sm text-ink-2">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
