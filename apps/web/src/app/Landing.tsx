"use client";

/** `/`: signed-in people go to their balance; everyone else gets onboarding, plus a way into the venue app. */
import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon, buttonClasses } from "@/components/ui";
import { safeNext } from "@/lib/nav";
import { useSession } from "@/state/session";
import { useDeviceWallet } from "@/state/wallet";
import { Onboarding } from "./_components/AccountGate";
import { RouteLoading } from "./_components/RouteLoading";

export function Landing() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const wallet = useDeviceWallet();
  const session = useSession();
  const signedIn = !!wallet && !!session && session.address.toLowerCase() === wallet.address.toLowerCase();

  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  if (wallet === undefined || signedIn) return <RouteLoading />;
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Onboarding
        onDone={() => router.replace(next)}
        headerAction={
          <Link href="/venue" className={buttonClasses({ variant: "ghost", size: "sm", className: "gap-1.5" })}>
            <Icon name="store" size={16} />
            I run a venue
          </Link>
        }
      />
    </div>
  );
}
