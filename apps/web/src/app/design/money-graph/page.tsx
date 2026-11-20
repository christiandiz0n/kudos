import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@vouch/shared";
import { MoneyGraphPlayground } from "../_mocks/MoneyGraphPlayground";

export const metadata: Metadata = { title: `${APP_NAME} · Money graph` };

/** Money graph v1 playground (UI_DESIGN venue, Phase 3): seeded networks at 5 / 20 / 60 people. */
export default function MoneyGraphPage() {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-[1320px]">
        <Link href="/design" className="focus-ring rounded-xs text-caption font-semibold text-primary-ink underline-offset-4 hover:underline">
          ← Design system
        </Link>
        <h1 className="mt-2 text-title-1 text-ink">Money graph</h1>
        <p className="mt-1 max-w-[68ch] text-body text-ink-2">
          The venue&apos;s signature view: where each payment went. Edge width ∝ √amount. Seeded, deterministic data; the
          highlighted payment is always Ben&apos;s $12.00.
        </p>
        <div className="mt-8">
          <MoneyGraphPlayground />
        </div>
      </div>
    </main>
  );
}
