"use client";

/**
 * QE-3-01: a `/pay` link whose `v` / `o` params can't be a payment (missing, cut off, mistyped). Shown by PayRoute
 * BEFORE sign-in or any quote: nothing was looked up, so there is no "Try again", only a new code. Same copy and
 * actions as UI_DESIGN's PayProblem "invalidLink" (which PayFlow shows in the sheet when the api doesn't know the
 * order or venue), laid out as a full screen because there is no order to put a sheet over.
 */
import { useRouter } from "next/navigation";
import { Screen } from "@/components/ui";
import { PayProblemActions, PayProblemPanel } from "@/screens/customer/PayProblem";

export function InvalidPayLink() {
  const router = useRouter();
  const p = { problem: "invalidLink" as const, amount: 0n, onRescan: () => router.push("/scan"), onDone: () => router.push("/") };
  return (
    <Screen
      footer={
        <div className="flex flex-col gap-2">
          <PayProblemActions {...p} />
        </div>
      }
    >
      <div data-pay-state="invalid-link">
        <PayProblemPanel {...p} className="pt-24 pb-6" />
      </div>
    </Screen>
  );
}
