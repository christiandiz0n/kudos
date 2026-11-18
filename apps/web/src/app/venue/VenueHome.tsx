"use client";

/** /venue — the venue app's entry: sign in (same Face ID account), then your venue's dashboard or onboarding. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { lastVenue } from "@/lib/venueStore";
import { AccountGate, type AccountCtx } from "../_components/AccountGate";
import { RouteLoading } from "../_components/RouteLoading";

function Redirect({ address }: AccountCtx) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    api
      .session()
      .then((s) => {
        if (!alive) return;
        const registered = s.venues.filter((v) => v.status === "registered");
        const remembered = lastVenue(address);
        const pick = registered.find((v) => v.venue.toLowerCase() === remembered?.toLowerCase()) ?? registered[0];
        const inFlight = s.venues.find((v) => v.status === "relaying");
        if (pick) router.replace(`/venue/${pick.venue}`);
        else if (inFlight) router.replace(`/venue/new?pending=${inFlight.venue}`);
        else router.replace("/venue/new");
      })
      .catch(() => alive && router.replace("/venue/new"));
    return () => {
      alive = false;
    };
  }, [address, router]);
  return <RouteLoading />;
}

export function VenueHome() {
  return <AccountGate>{(ctx) => <Redirect {...ctx} />}</AccountGate>;
}
