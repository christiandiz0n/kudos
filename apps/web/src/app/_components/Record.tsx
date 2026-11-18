"use client";

/** Ambassador record (GET /ambassadors/:address, Streams-derived): owner view at /me, public view at /a/<address>. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AmbassadorScreen, type AmbassadorVenue } from "@/screens/customer/AmbassadorScreen";
import { api, money, type AmbassadorRes } from "@/lib/api";
import { webOrigin } from "@/lib/config";

function venuesOf(a: AmbassadorRes): AmbassadorVenue[] {
  const by = new Map<string, { customers: Set<string>; earned: bigint }>();
  for (const l of a.recent) {
    if (l.returned || l.role === "cashback") continue;
    const k = l.venue.toLowerCase();
    const row = by.get(k) ?? { customers: new Set<string>(), earned: 0n };
    if (l.role === "referrer") row.customers.add(l.customer.toLowerCase());
    row.earned += money(l.amount);
    by.set(k, row);
  }
  return a.venues
    .map((v) => {
      const row = by.get(v.venue.toLowerCase());
      const n = row?.customers.size ?? 0;
      return { name: v.name ?? "A local place", meta: n ? "First visits you sent" : "Recommended", customers: n, earned: row?.earned ?? 0n };
    })
    .sort((x, y) => (y.earned > x.earned ? 1 : y.earned < x.earned ? -1 : 0));
}

export function Record({ address, viewer, fallbackName }: { address: string; viewer: "owner" | "visitor"; fallbackName?: string }) {
  const router = useRouter();
  const [a, setA] = useState<AmbassadorRes | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.ambassador(address).then(setA).catch(() => setA(null));
  }, [address]);

  async function share() {
    const url = `${webOrigin()}/a/${address}`;
    try {
      if (navigator.share) await navigator.share({ title: "My Vouch record", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* dismissed */
    }
  }

  return (
    <AmbassadorScreen
      name={a?.displayName ?? fallbackName ?? "A Vouch ambassador"}
      verifiedCustomers={a?.customersCredited ?? 0}
      venueCount={a?.venues.length ?? 0}
      earned={a ? money(a.earned.total) : 0n}
      venues={a ? venuesOf(a) : []}
      viewer={viewer}
      loading={!a}
      recordId={address}
      copied={copied}
      onShare={viewer === "owner" ? share : undefined}
      onBack={() => router.push(viewer === "owner" ? "/wallet" : "/")}
    />
  );
}
