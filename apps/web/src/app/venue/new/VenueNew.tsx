"use client";

/**
 * /venue/new — venue onboarding: name → reward + minimum (VenueOnboardingScreen) → owner confirms with Face ID →
 * POST /venues/prepare → sign RegisterVenue → POST /venues (relayed) → wait for `venue.registered` (Streams) → dashboard.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAddress } from "viem";
import { parseUsdc } from "@vouch/shared";
import { VenueOnboardingScreen, validateMinOrder } from "@/screens/venue/VenueOnboardingScreen";
import { ApiError, api, friendlyError, waitRelay } from "@/lib/api";
import { getSigner } from "@/lib/wallet";
import { signTypedDataJson } from "@/lib/sign";
import { rememberVenue } from "@/lib/venueStore";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useToasts } from "@/hooks/useToasts";
import { AccountGate, type AccountCtx } from "../../_components/AccountGate";

const EXAMPLE_ORDER = parseUsdc("12.00");

function Flow({ address }: AccountCtx) {
  const router = useRouter();
  const params = useSearchParams();
  const toasts = useToasts();
  const [name, setName] = useState("");
  const [rewardBps, setRewardBps] = useState(1500);
  const [minOrder, setMinOrder] = useState("1.00");
  const [status, setStatus] = useState<"idle" | "confirming" | "saving" | "error">("idle");
  const [error, setError] = useState<string | undefined>();
  const fail = useCallback((msg: string) => {
    setStatus("error");
    setError(msg);
  }, []);
  const pendingParam = params.get("pending");
  const [pendingVenue, setPendingVenue] = useState<string | null>(pendingParam && isAddress(pendingParam) ? pendingParam : null);

  const doneOnce = useRef(false);
  const done = useCallback(
    (venue: string) => {
      if (doneOnce.current) return;
      doneOnce.current = true;
      rememberVenue(address, venue);
      toasts.push({ tone: "success", title: "You're live", description: "Customers can now pay you and recommend you." });
      router.replace(`/venue/${venue}`);
    },
    [address, router, toasts],
  );

  useLiveEvents({ kind: "user", id: address }, (ev, data) => {
    if (ev === "venue.registered" && pendingVenue && String(data.venue).toLowerCase() === pendingVenue.toLowerCase()) done(pendingVenue);
    if (ev === "venue.failed" && pendingVenue && String(data.venue).toLowerCase() === pendingVenue.toLowerCase()) {
      setPendingVenue(null);
      fail("We couldn't save your place. Nothing was charged. Try again.");
    }
  });

  // Polling fallback: registered once Streams has ingested VenueRegistered.
  useEffect(() => {
    if (!pendingVenue) return;
    const iv = setInterval(async () => {
      try {
        const v = await api.venue(pendingVenue);
        if (v.status === "registered" && !v.waitingOnStreams) done(pendingVenue);
        if (v.status === "failed") {
          setPendingVenue(null);
          fail("We couldn't save your place. Nothing was charged. Try again.");
        }
      } catch {
        /* keep waiting */
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [pendingVenue, done, fail]);

  async function save() {
    if (validateMinOrder(minOrder) || !name.trim()) return;
    const min = parseUsdc(minOrder.trim().replace(/^\$/, "") || "0");
    setError(undefined);
    setStatus("confirming");
    try {
      const prep = await api.venuePrepare({ name: name.trim(), rewardBps, minOrder: min.toString() });
      const signer = await getSigner();
      const signature = await signTypedDataJson(signer, prep.typedData);
      setStatus("saving");
      const res = await api.venueSubmit({ venue: prep.venue, signature });
      setPendingVenue(res.venue);
      waitRelay(res.relayId)
        // Mined on chain = registered. Normally Streams' venue.registered lands within ~2 s; if Streams lags
        // (paused / catching up), continue after 15 s so onboarding never hangs. The dashboard fills in later.
        .then(() => setTimeout(() => done(res.venue), 15_000))
        .catch((e) => {
        if (e instanceof ApiError && e.code !== "TIMEOUT") {
          setPendingVenue(null);
          fail(friendlyError(e));
        }
      });
    } catch (e) {
      fail(friendlyError(e));
    }
  }

  return (
    <VenueOnboardingScreen
      venueName={name}
      onVenueNameChange={setName}
      rewardBps={rewardBps}
      onRewardBpsChange={setRewardBps}
      exampleOrder={EXAMPLE_ORDER}
      minOrder={minOrder}
      onMinOrderChange={setMinOrder}
      minOrderError={validateMinOrder(minOrder)}
      status={pendingVenue ? "saving" : status}
      error={error}
      onConfirm={save}
    />
  );
}

export function VenueNew() {
  return <AccountGate>{(ctx) => <Flow {...ctx} />}</AccountGate>;
}
