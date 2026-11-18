import { Suspense, type ReactNode } from "react";
import { BrowserOnly } from "./BrowserOnly";
import { RouteLoading } from "./RouteLoading";

/** Server wrapper for every app route: static loading shell, real screen in the browser. */
export function ClientPage({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteLoading />}>
      <BrowserOnly>{children}</BrowserOnly>
    </Suspense>
  );
}
