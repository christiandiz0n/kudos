"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/design/cn";

const InFrame = createContext(false);

/**
 * A9 desktop framing. Below 640px it is layout-neutral (390px renders exactly as before). From 640px up the app
 * sits in a centered, phone-sized column (460px; `doc` = 760px for long reading pages) on a soft blue backdrop,
 * with comfortable top/bottom spacing. The column has a definite height, so <Screen/> scrolls inside it and its
 * sticky footer stays inside the column. Nest-safe: an inner <AppFrame/> renders its children as-is.
 * See `.vx-app-frame` / `.vx-app-column` in tokens.css.
 */
export function AppFrame({ children, size = "phone", className }: { children: ReactNode; size?: "phone" | "doc"; className?: string }) {
  const nested = useContext(InFrame);
  if (nested) return <>{children}</>;
  return (
    <InFrame.Provider value>
      <div data-vx-frame={size} className="vx-app-frame flex min-h-full flex-1 flex-col">
        <div data-size={size} className="vx-app-shell flex min-h-full flex-1 flex-col">
          <div data-size={size} className={cn("vx-app-column flex min-h-full flex-1 flex-col", className)}>
            {children}
          </div>
        </div>
      </div>
    </InFrame.Provider>
  );
}
