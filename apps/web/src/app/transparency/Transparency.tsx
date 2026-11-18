"use client";

/**
 * /transparency[?venue=<venue>] — public "how payments split" page: exact formula, worked example (canonical story),
 * the live Vouch contract from @vouch/shared deployments, USDC, explorer links. With ?venue= it shows that venue's
 * current terms (GET /venues/:venue/terms).
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isAddress } from "viem";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_EXPLORER_URL, ARC_TESTNET_USDC_ADDRESS, VOUCH_ARC_TESTNET, parseUsdc } from "@vouch/shared";
import { TransparencyScreen } from "@/screens/public/TransparencyScreen";
import { api } from "@/lib/api";

const STORY = {
  customer: "Ben",
  total: parseUsdc("12.00"),
  referrers: [
    { name: "Ana", weightBps: 7000, introducer: "Sam" },
    { name: "Priya", weightBps: 3000, introducer: "Ana" },
  ],
};

export function Transparency() {
  const params = useSearchParams();
  const v = params.get("venue");
  const [terms, setTerms] = useState({ venueName: "Lena's café", rewardBps: 1500, termsVersion: 1, termsSince: "registration" });

  useEffect(() => {
    if (!v || !isAddress(v)) return;
    api
      .venue(v)
      .then((venue) => {
        const t = venue.terms;
        setTerms({
          venueName: venue.name ?? "this venue",
          rewardBps: t?.rewardBps ?? 1500,
          termsVersion: t?.termsVersion ?? 1,
          termsSince: t?.effectiveAt ? new Date(Number(t.effectiveAt) * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "registration",
        });
      })
      .catch(() => {});
  }, [v]);

  return (
    <TransparencyScreen
      {...terms}
      example={STORY}
      contractAddress={VOUCH_ARC_TESTNET.address}
      deployTx={VOUCH_ARC_TESTNET.deployTx}
      deployBlock={VOUCH_ARC_TESTNET.deployBlock}
      tokenAddress={ARC_TESTNET_USDC_ADDRESS}
      explorerUrl={ARC_TESTNET_EXPLORER_URL}
      network="Arc Testnet"
      chainId={ARC_TESTNET_CHAIN_ID}
    />
  );
}
