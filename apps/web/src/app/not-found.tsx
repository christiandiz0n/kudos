import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Screen, buttonClasses } from "@/components/ui";

/** QE-3-08: on-brand 404 for unknown paths, with a way home (existing components only; static, server-rendered). */
export const metadata: Metadata = { title: "Page not found · Kudos" };

export default function NotFound() {
  return (
    <Screen
      footer={
        <div className="flex flex-col gap-2">
          <Link href="/" className={buttonClasses({ size: "lg", block: true })}>
            Go to Kudos
          </Link>
          <Link href="/scan" className={buttonClasses({ variant: "ghost", block: true })}>
            Scan a code
          </Link>
        </div>
      }
    >
      <EmptyState
        className="pt-24"
        icon="link"
        tone="neutral"
        title="We can't find that page"
        body="The link may be mistyped or out of date. Nothing has changed in your account."
      />
    </Screen>
  );
}
