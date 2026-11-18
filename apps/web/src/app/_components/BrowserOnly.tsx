"use client";

/**
 * Client-only boundary (Next 16 + Cache Components): the app's account, session and keys live in the browser
 * (IndexedDB / localStorage), so routes render a static loading shell on the server and the real screen only in the
 * browser. Wrap in <Suspense fallback={<RouteLoading/>}> (see the route page.tsx files).
 */
import { use, type ReactNode } from "react";
import { browser } from "react-dom";

export function BrowserOnly({ children }: { children: ReactNode }) {
  use(browser("Account, session and keys live in this browser only."));
  return <>{children}</>;
}
