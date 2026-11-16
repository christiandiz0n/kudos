import Link from "next/link";
import { APP_NAME, SPLIT_BPS, formatUsd, parseUsdc } from "@wom/shared";

// Phase 0 placeholder home. Proves the @wom/shared workspace link (APP_NAME + bigint money helpers).
export default function Home() {
  const sample = parseUsdc("12.00");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-10">
      <h1 className="text-4xl font-bold tracking-tight">{APP_NAME}</h1>
      <p className="text-zinc-500">
        Phase 0 scaffold. Sample sale {formatUsd(sample)}; cashback share {SPLIT_BPS.CASHBACK / 100}% of the reward
        pool.
      </p>
      <nav className="flex flex-col gap-3">
        <Link className="rounded-xl bg-foreground px-4 py-3 text-center text-background" href="/spike/scan">
          S6 spike: scan a QR
        </Link>
        <Link
          className="rounded-xl border border-zinc-300 px-4 py-3 text-center"
          href="/spike/qr?text=hello%20from%20the%20laptop"
        >
          S6 spike: show a QR
        </Link>
      </nav>
    </main>
  );
}
