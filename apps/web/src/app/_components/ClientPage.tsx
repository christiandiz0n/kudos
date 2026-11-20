import { Suspense, type ReactNode } from "react";
import { AppFrame } from "@/components/ui/AppFrame";
import { BrowserOnly } from "./BrowserOnly";
import { RouteLoading } from "./RouteLoading";

/**
 * Server wrapper for every app route: static loading shell, real screen in the browser.
 * `frame` (A9 desktop): "phone" (default) = centered phone column from 640px up; "doc" = wider reading column;
 * "none" = the screen lays itself out (the venue dashboard's projector layout).
 */
export function ClientPage({ children, frame = "phone" }: { children: ReactNode; frame?: "phone" | "doc" | "none" }) {
  const page = (
    <Suspense fallback={<RouteLoading />}>
      <BrowserOnly>{children}</BrowserOnly>
    </Suspense>
  );
  return frame === "none" ? page : <AppFrame size={frame}>{page}</AppFrame>;
}
